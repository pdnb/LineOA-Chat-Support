import { Contact, Conversation, Prisma, SenderType } from '@prisma/client';
import { channelScope } from './access';
import { audit } from './audit';
import { AuthUser } from './auth';
import { prisma } from './db';
import { env } from './env';
import { badRequest, conflict, forbidden, notFound } from './http';
import { getLineClient, LineMessage } from './line/client';
import { emit, emitToUser, onlineUserIds } from './realtime';

export const CONVERSATION_INCLUDE = {
  contact: true,
  channel: { select: { id: true, name: true, basicId: true, pictureUrl: true } },
  assignedTo: { select: { id: true, name: true } },
  category: { select: { id: true, code: true, name: true, form: true } },
} satisfies Prisma.ConversationInclude;

const MESSAGE_INCLUDE = { senderUser: { select: { id: true, name: true } } } satisfies Prisma.MessageInclude;

export type ConversationView = 'queue' | 'mine' | 'bot' | 'resolved' | 'all';
export const CONVERSATION_VIEWS: ConversationView[] = ['queue', 'mine', 'bot', 'resolved', 'all'];

/** Who performed an action; null = the system (bot, auto-assign). */
export type Actor = Pick<AuthUser, 'id' | 'name' | 'role'>;

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

/** Serializes opening and reopening a customer's conversation, so a contact never has two open ones. */
async function lockContact(tx: Prisma.TransactionClient, contactId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Contact" WHERE id = ${contactId} FOR UPDATE`;
}

/** The customer's open conversation, or a fresh one in BOT mode. */
export async function getOrOpen(contact: Pick<Contact, 'id' | 'channelId'>): Promise<Conversation> {
  return prisma.$transaction(async (tx) => {
    await lockContact(tx, contact.id);
    const open = await tx.conversation.findFirst({
      where: { contactId: contact.id, status: { not: 'RESOLVED' } },
      orderBy: { createdAt: 'desc' },
    });
    return open ?? tx.conversation.create({ data: { contactId: contact.id, channelId: contact.channelId } });
  });
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
 * `records` overrides how a message is stored (e.g. a file sent to LINE as a link text is stored as a file).
 * Throws if LINE rejects the push so queue callers can retry.
 */
export async function send(
  conv: Conversation,
  contact: Contact,
  messages: LineMessage[],
  opts: {
    replyToken?: string;
    senderType: SenderType;
    userId?: string;
    payloads?: Prisma.InputJsonValue[];
    records?: { type: string; text: string | null }[];
  },
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

  const stored = messages.map((m, i) => opts.records?.[i] ?? describeOutgoing(m));
  const created = [];
  for (const [i, m] of messages.entries()) {
    created.push(
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: 'OUT',
          senderType: opts.senderType,
          senderUserId: opts.userId,
          type: stored[i].type,
          text: stored[i].text,
          payload: opts.payloads?.[i] ?? (m as unknown as Prisma.InputJsonValue),
        },
        include: MESSAGE_INCLUDE,
      }),
    );
  }
  const last = stored[stored.length - 1];
  const extra: Prisma.ConversationUpdateInput = {};
  if (opts.senderType === 'AGENT') {
    extra.unreadCount = 0;
    if (!conv.firstResponseAt && conv.queuedAt) {
      extra.firstResponseAt = new Date();
      extra.firstResponderId = opts.userId;
    }
  }
  await touch(conv.id, previewOf(last.type, last.text), extra);
  for (const m of created) emit('message.created', m, conv.channelId);
  return created;
}

export async function handoff(conversationId: string, note = 'ลูกค้าขอคุยกับเจ้าหน้าที่', actor: Actor | null = null) {
  const current = await mustGet(conversationId);
  const now = new Date();
  let conv = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: 'QUEUED',
      // Once an agent has answered, queuedAt stays at the original queue time so
      // first-response time (firstResponseAt − queuedAt) can't go negative on a re-queue.
      queuedAt: current.firstResponseAt ? undefined : now,
      waitingSince: now,
      slaAlertedAt: null,
      botState: Prisma.DbNull,
    },
  });
  await recordSystem(conv, note);
  if (actor) await audit(actor, 'conversation.handoff', { type: 'conversation', id: conversationId });
  if (env.autoAssign) {
    const agentId = await pickAgent(conv.channelId);
    if (agentId) conv = await assign(conv.id, agentId, null);
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

/** The user, if they are active and may handle chats of this OA; throws 400 otherwise. */
async function assertCovers(userId: string, channelId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { channels: { where: { id: channelId }, select: { id: true } } },
  });
  if (!user || !user.isActive) throw badRequest('ไม่พบเจ้าหน้าที่');
  if (user.role !== 'ADMIN' && !user.channels.length) throw badRequest(`${user.name} ไม่ได้ดูแล LINE OA นี้`);
  return user;
}

export async function assign(conversationId: string, userId: string, actor: Actor | null) {
  const conv = await mustGet(conversationId);
  if (conv.status === 'RESOLVED') throw badRequest('Conversation is resolved');
  const user = await assertCovers(userId, conv.channelId);
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: 'ASSIGNED',
      assignedToId: userId,
      queuedAt: conv.queuedAt ?? new Date(),
      waitingSince: null,
      slaAlertedAt: null,
      botState: Prisma.DbNull,
    },
  });
  await recordSystem(updated, `${user.name} รับเรื่อง`);
  await audit(actor, 'conversation.assign', { type: 'conversation', id: conversationId }, { to: userId });
  await emitConversation(conversationId);
  return updated;
}

/** Hand an assigned chat to another agent. Only its current owner or an admin may do this. */
export async function transfer(conversationId: string, toUserId: string, actor: Actor, note?: string) {
  const conv = await mustGet(conversationId);
  if (conv.status !== 'ASSIGNED') throw badRequest('โอนได้เฉพาะแชตที่มีผู้ดูแลอยู่');
  if (conv.assignedToId !== actor.id && actor.role !== 'ADMIN') throw forbidden('โอนได้เฉพาะแชตที่คุณดูแลอยู่');
  if (conv.assignedToId === toUserId) throw badRequest('เจ้าหน้าที่ท่านนี้ดูแลแชตนี้อยู่แล้ว');
  const target = await assertCovers(toUserId, conv.channelId);
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { assignedToId: toUserId, slaAlertedAt: null },
  });
  const trimmed = note?.trim();
  await recordSystem(updated, `${actor.name} โอนเรื่องให้ ${target.name}${trimmed ? `: ${trimmed}` : ''}`);
  await audit(actor, 'conversation.transfer', { type: 'conversation', id: conversationId }, {
    from: conv.assignedToId,
    to: toUserId,
    note: trimmed || undefined,
  });
  await emitConversation(conversationId);
  emitToUser(toUserId, 'conversation.transferred', {
    conversationId,
    from: actor.name,
    note: trimmed || null,
    contactName: conv.contact.displayName,
  });
  return updated;
}

export async function resolve(conversationId: string, actor: Actor) {
  await mustGet(conversationId);
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedById: actor.id,
      waitingSince: null,
      botState: Prisma.DbNull,
      unreadCount: 0,
    },
  });
  await recordSystem(updated, `${actor.name} ปิดเรื่อง`);
  await audit(actor, 'conversation.resolve', { type: 'conversation', id: conversationId });
  await emitConversation(conversationId);
  return updated;
}

/**
 * Reopen a resolved chat and take it. Refused while the customer already has another open chat
 * (a newer message opened one): the console points the agent there instead.
 */
export async function reopen(conversationId: string, actor: Actor) {
  const conv = await mustGet(conversationId);
  if (conv.status !== 'RESOLVED') throw badRequest('แชตนี้ยังไม่ได้ปิด');
  await assertCovers(actor.id, conv.channelId);
  const updated = await prisma.$transaction(async (tx) => {
    await lockContact(tx, conv.contactId);
    const open = await tx.conversation.findFirst({
      where: { contactId: conv.contactId, status: { not: 'RESOLVED' }, id: { not: conversationId } },
      select: { id: true },
    });
    if (open) throw conflict('ลูกค้ามีแชตใหม่ที่เปิดอยู่แล้ว');
    return tx.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'ASSIGNED',
        assignedToId: actor.id,
        resolvedAt: null,
        resolvedById: null,
        waitingSince: null,
        slaAlertedAt: null,
      },
    });
  });
  await recordSystem(updated, `${actor.name} เปิดเรื่องอีกครั้ง`);
  await audit(actor, 'conversation.reopen', { type: 'conversation', id: conversationId });
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

export async function list(
  view: ConversationView,
  user: AuthUser,
  q?: string,
  channelId?: string | null,
  tag?: string | null,
) {
  const where: Prisma.ConversationWhereInput = { channelId: channelScope(user, channelId) };
  if (view === 'queue') where.status = 'QUEUED';
  if (view === 'mine') Object.assign(where, { status: 'ASSIGNED', assignedToId: user.id });
  if (view === 'bot') where.status = 'BOT';
  if (view === 'resolved') where.status = 'RESOLVED';
  if (tag) where.contact = { tags: { has: tag } };
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

export const MESSAGE_PAGE = 50;

/**
 * One page of a conversation's messages, oldest first. Without `before` it is the latest page;
 * with `before` (a message id) the page just before that message.
 */
export async function listMessages(conversationId: string, opts: { before?: string | null; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? MESSAGE_PAGE, 1), 100);
  let where: Prisma.MessageWhereInput = { conversationId };
  if (opts.before) {
    const pivot = await prisma.message.findFirst({
      where: { id: opts.before, conversationId },
      select: { id: true, createdAt: true },
    });
    if (!pivot) throw badRequest('Unknown message');
    where = {
      conversationId,
      OR: [{ createdAt: { lt: pivot.createdAt } }, { createdAt: pivot.createdAt, id: { lt: pivot.id } }],
    };
  }
  const rows = await prisma.message.findMany({
    where,
    include: MESSAGE_INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse(), hasMore };
}

export async function detail(id: string) {
  const conv = await prisma.conversation.findUnique({ where: { id }, include: CONVERSATION_INCLUDE });
  if (!conv) throw notFound();
  const { messages, hasMore } = await listMessages(id);
  return { ...conv, messages, hasMoreMessages: hasMore };
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
export async function ownedForReply(id: string, user: Actor) {
  const conv = await mustGet(id);
  if (conv.status === 'ASSIGNED' && conv.assignedToId !== user.id && user.role !== 'ADMIN') {
    throw forbidden('แชตนี้มีเจ้าหน้าที่ท่านอื่นดูแลอยู่');
  }
  if (conv.status === 'RESOLVED') throw badRequest('แชตนี้ปิดแล้ว');
  if (conv.status !== 'ASSIGNED') {
    await assign(id, user.id, user);
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
