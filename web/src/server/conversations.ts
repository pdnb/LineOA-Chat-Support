import { Contact, Conversation, Prisma, SenderType } from '@prisma/client';
import { channelScope } from './access';
import { AuthUser } from './auth';
import { prisma } from './db';
import { env } from './env';
import { badRequest, forbidden, notFound } from './http';
import { getLineClient, LineMessage } from './line/client';
import { emit, onlineUserIds } from './realtime';

export const CONVERSATION_INCLUDE = {
  contact: true,
  channel: { select: { id: true, name: true, basicId: true, pictureUrl: true } },
  assignedTo: { select: { id: true, name: true } },
  category: { select: { id: true, code: true, name: true, form: true } },
} satisfies Prisma.ConversationInclude;

export type ConversationView = 'queue' | 'mine' | 'bot' | 'resolved' | 'all';
export const CONVERSATION_VIEWS: ConversationView[] = ['queue', 'mine', 'bot', 'resolved', 'all'];

export interface InboundMessage {
  type: string;
  text?: string | null;
  payload?: Prisma.InputJsonValue;
  lineMessageId?: string;
}

export function previewOf(type: string, text?: string | null): string {
  if (text) return text.slice(0, 200);
  const labels: Record<string, string> = {
    image: '[รูปภาพ]',
    sticker: '[สติกเกอร์]',
    video: '[วิดีโอ]',
    audio: '[เสียง]',
    file: '[ไฟล์]',
    location: '[ตำแหน่ง]',
    flex: '[การ์ด]',
  };
  return labels[type] ?? `[${type}]`;
}

function describeOutgoing(m: LineMessage): { type: string; text: string | null } {
  switch (m.type) {
    case 'text':
      return { type: 'text', text: m.text };
    case 'flex':
      return { type: 'flex', text: m.altText };
    default:
      return { type: m.type, text: null };
  }
}

/** The customer's open conversation, or a fresh one in BOT mode. */
export async function getOrOpen(contact: Pick<Contact, 'id' | 'channelId'>): Promise<Conversation> {
  const open = await prisma.conversation.findFirst({
    where: { contactId: contact.id, status: { not: 'RESOLVED' } },
    orderBy: { createdAt: 'desc' },
  });
  return open ?? prisma.conversation.create({ data: { contactId: contact.id, channelId: contact.channelId } });
}

export async function recordInbound(conv: Conversation, msg: InboundMessage) {
  const message = await prisma.message.create({
    data: {
      conversationId: conv.id,
      direction: 'IN',
      senderType: 'CUSTOMER',
      type: msg.type,
      text: msg.text ?? null,
      payload: msg.payload,
      lineMessageId: msg.lineMessageId,
    },
  });
  await touch(conv.id, previewOf(msg.type, msg.text), { unreadCount: { increment: 1 } });
  emit('message.created', message, conv.channelId);
  return message;
}

/** System notes are visible in the console only; they are never sent to LINE. */
export async function recordSystem(conv: Pick<Conversation, 'id' | 'channelId'>, text: string) {
  const message = await prisma.message.create({
    data: { conversationId: conv.id, direction: 'OUT', senderType: 'SYSTEM', type: 'system', text },
  });
  emit('message.created', message, conv.channelId);
  return message;
}

/**
 * Send to the customer on LINE (reply token first, push as fallback) and record the messages.
 * Throws if LINE rejects the push so queue callers can retry.
 */
export async function send(
  conv: Conversation,
  contact: Contact,
  messages: LineMessage[],
  opts: { replyToken?: string; senderType: SenderType; userId?: string; payloads?: Prisma.InputJsonValue[] },
) {
  if (!messages.length) return [];
  const line = await getLineClient(contact.channelId);
  let delivered = false;
  if (opts.replyToken) {
    try {
      await line.reply(opts.replyToken, messages);
      delivered = true;
    } catch (err) {
      console.warn(`[conversations] reply failed, falling back to push: ${(err as Error).message}`);
    }
  }
  if (!delivered) await line.push(contact.lineUserId, messages);

  const created = [];
  for (const [i, m] of messages.entries()) {
    const { type, text } = describeOutgoing(m);
    created.push(
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: 'OUT',
          senderType: opts.senderType,
          senderUserId: opts.userId,
          type,
          text,
          payload: opts.payloads?.[i] ?? (m as unknown as Prisma.InputJsonValue),
        },
        include: { senderUser: { select: { id: true, name: true } } },
      }),
    );
  }
  const last = describeOutgoing(messages[messages.length - 1]);
  const extra: Prisma.ConversationUpdateInput = {};
  if (opts.senderType === 'AGENT') {
    extra.unreadCount = 0;
    if (!conv.firstResponseAt && conv.queuedAt) extra.firstResponseAt = new Date();
  }
  await touch(conv.id, previewOf(last.type, last.text), extra);
  for (const m of created) emit('message.created', m, conv.channelId);
  return created;
}

export async function handoff(conversationId: string, note = 'ลูกค้าขอคุยกับเจ้าหน้าที่') {
  const current = await mustGet(conversationId);
  let conv = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: 'QUEUED',
      // Once an agent has answered, queuedAt stays at the original queue time so
      // first-response time (firstResponseAt − queuedAt) can't go negative on a re-queue.
      queuedAt: current.firstResponseAt ? undefined : new Date(),
      botState: Prisma.DbNull,
    },
  });
  await recordSystem(conv, note);
  if (env.autoAssign) {
    const agentId = await pickAgent(conv.channelId);
    if (agentId) conv = await assign(conv.id, agentId);
  }
  await emitConversation(conv.id);
  return conv;
}

/** Least-busy online agent who may see this OA, or null if nobody is online. */
async function pickAgent(channelId: string): Promise<string | null> {
  const online = onlineUserIds();
  if (!online.length) return null;
  const users = await prisma.user.findMany({
    where: { id: { in: online }, isActive: true, OR: [{ role: 'ADMIN' }, { channels: { some: { id: channelId } } }] },
    select: { id: true, _count: { select: { assigned: { where: { status: 'ASSIGNED' } } } } },
  });
  users.sort((a, b) => a._count.assigned - b._count.assigned);
  return users[0]?.id ?? null;
}

export async function assign(conversationId: string, userId: string) {
  const conv = await mustGet(conversationId);
  if (conv.status === 'RESOLVED') throw badRequest('Conversation is resolved');
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { channels: { where: { id: conv.channelId }, select: { id: true } } },
  });
  if (user.role !== 'ADMIN' && !user.channels.length) throw badRequest(`${user.name} ไม่ได้ดูแล LINE OA นี้`);
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: 'ASSIGNED',
      assignedToId: userId,
      queuedAt: conv.queuedAt ?? new Date(),
      botState: Prisma.DbNull,
    },
  });
  await recordSystem(updated, `${user.name} รับเรื่อง`);
  await emitConversation(conversationId);
  return updated;
}

export async function resolve(conversationId: string, byName: string) {
  await mustGet(conversationId);
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'RESOLVED', resolvedAt: new Date(), botState: Prisma.DbNull, unreadCount: 0 },
  });
  await recordSystem(updated, `${byName} ปิดเรื่อง`);
  await emitConversation(conversationId);
  return updated;
}

export async function updateBot(
  conversationId: string,
  data: { botState: Prisma.InputJsonValue | null; collected: Prisma.InputJsonValue; categoryId: string | null },
) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: {
      botState: data.botState ?? Prisma.DbNull,
      collected: data.collected,
      categoryId: data.categoryId,
    },
  });
}

export async function list(view: ConversationView, user: AuthUser, q?: string, channelId?: string | null) {
  const where: Prisma.ConversationWhereInput = { channelId: channelScope(user, channelId) };
  if (view === 'queue') where.status = 'QUEUED';
  if (view === 'mine') Object.assign(where, { status: 'ASSIGNED', assignedToId: user.id });
  if (view === 'bot') where.status = 'BOT';
  if (view === 'resolved') where.status = 'RESOLVED';
  if (q) {
    where.OR = [
      { contact: { displayName: { contains: q, mode: 'insensitive' } } },
      { contact: { phone: { contains: q } } },
      { lastMessageText: { contains: q, mode: 'insensitive' } },
    ];
  }
  return prisma.conversation.findMany({
    where,
    include: CONVERSATION_INCLUDE,
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });
}

export async function counts(user: AuthUser, channelId?: string | null) {
  const scope = channelScope(user, channelId);
  const [queue, mine, bot] = await Promise.all([
    prisma.conversation.count({ where: { channelId: scope, status: 'QUEUED' } }),
    prisma.conversation.count({ where: { channelId: scope, status: 'ASSIGNED', assignedToId: user.id } }),
    prisma.conversation.count({ where: { channelId: scope, status: 'BOT' } }),
  ]);
  return { queue, mine, bot };
}

export async function detail(id: string) {
  const conv = await prisma.conversation.findUnique({
    where: { id },
    include: {
      ...CONVERSATION_INCLUDE,
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 500,
        include: { senderUser: { select: { id: true, name: true } } },
      },
    },
  });
  if (!conv) throw notFound();
  return conv;
}

/** Conversation history for one customer across all their conversations (newest first). */
export async function history(contactId: string) {
  return prisma.conversation.findMany({
    where: { contactId },
    include: CONVERSATION_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}

export async function markRead(id: string) {
  await prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  await emitConversation(id);
}

export async function mustGet(id: string) {
  const conv = await prisma.conversation.findUnique({ where: { id }, include: { contact: true } });
  if (!conv) throw notFound('Conversation not found');
  return conv;
}

/** Agents reply in chats they own; a queued chat is claimed automatically on first reply. */
export async function ownedForReply(id: string, user: { id: string; role: string }) {
  const conv = await mustGet(id);
  if (conv.status === 'ASSIGNED' && conv.assignedToId !== user.id && user.role !== 'ADMIN') {
    throw forbidden('แชตนี้มีเจ้าหน้าที่ท่านอื่นดูแลอยู่');
  }
  if (conv.status !== 'ASSIGNED') {
    await assign(id, user.id);
    return mustGet(id);
  }
  return conv;
}

export async function emitConversation(id: string) {
  const conv = await prisma.conversation.findUnique({ where: { id }, include: CONVERSATION_INCLUDE });
  if (conv) emit('conversation.updated', conv, conv.channelId);
}

async function touch(id: string, preview: string, extra: Prisma.ConversationUpdateInput = {}) {
  await prisma.conversation.update({
    where: { id },
    data: { lastMessageText: preview, lastMessageAt: new Date(), ...extra },
  });
  await emitConversation(id);
}
