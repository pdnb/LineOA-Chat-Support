import { Contact, Conversation, Prisma } from '@prisma/client';
import { BotInput, isTrackInput } from '../bot/engine';
import { handleBot } from '../bot/service';
import * as conversations from '../conversations';
import { InboundMessage } from '../conversations';
import { parseCsatPostback, recordCsat } from '../csat';
import { prisma } from '../db';
import { extFor, saveMedia } from '../media';
import { DEFAULT_CHANNEL_ID } from './channels';
import { getLineClient, LineClient } from './client';

export const LINE_EVENTS_QUEUE = 'line-events';

/** Minimal shape of the LINE webhook events we handle. */
export interface LineEvent {
  type: string;
  replyToken?: string;
  deliveryContext?: { isRedelivery: boolean };
  source?: { type: string; userId?: string };
  message?: {
    id: string;
    type: string;
    text?: string;
    fileName?: string;
    packageId?: string;
    stickerId?: string;
    title?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
  postback?: { data: string };
}

/** Queue payload. Tasks queued before multi-OA support are a bare LineEvent and belong to the default OA. */
export type LineEventTask = { channelId: string; event: LineEvent } | LineEvent;

const MEDIA_TYPES = ['image', 'video', 'audio', 'file'];

/** Queue handler. Events are processed one at a time, which keeps each customer's messages in order. */
export async function processLineEvent(task: LineEventTask) {
  const { channelId, event } = 'event' in task ? task : { channelId: DEFAULT_CHANNEL_ID, event: task };
  const userId = event.source?.userId;
  if (!userId) return; // group/room events without a user are ignored

  if (event.type === 'unfollow') return;
  const line = await getLineClient(channelId);
  const contact = await ensureContact(line, channelId, userId);
  const channel = await prisma.lineChannel.findUnique({ where: { id: channelId }, select: { botEnabled: true } });
  const botEnabled = channel?.botEnabled ?? true;

  if (event.type === 'follow') {
    // Without the bot there is nothing to say yet; the chat opens on the customer's first message.
    if (!botEnabled) return;
    const conv = await conversations.getOrOpen(contact);
    if (conv.status === 'BOT') await handleBot(conv, contact, { kind: 'follow' }, event.replyToken);
    return;
  }

  if (event.type === 'message' && event.message) {
    const seen = await prisma.message.findFirst({
      where: { lineMessageId: event.message.id, conversation: { channelId } },
    });
    // LINE redelivered an event we already handled. (A retry of our own task still runs the bot.)
    if (seen && event.deliveryContext?.isRedelivery) return;
    const conv = await conversations.getOrOpen(contact);
    if (!seen) await conversations.recordInbound(conv, await toInbound(line, event.message));
    const input: BotInput =
      event.message.type === 'text' ? { kind: 'text', text: event.message.text ?? '' } : { kind: 'other' };
    await respond(conv, contact, input, botEnabled, event.replyToken);
    return;
  }

  if (event.type === 'postback' && event.postback) {
    // A rating belongs to the (usually resolved) chat it was sent for: it must not open a new chat.
    const csat = parseCsatPostback(event.postback.data);
    if (csat) return recordCsat(channelId, userId, csat, event.replyToken);
    const conv = await conversations.getOrOpen(contact);
    const input: BotInput = { kind: 'postback', data: event.postback.data };
    await respond(conv, contact, input, botEnabled, event.replyToken);
    return;
  }
}

/** Let the bot answer, or when the OA has the bot switched off, queue the chat for an agent without replying. */
async function respond(conv: Conversation, contact: Contact, input: BotInput, botEnabled: boolean, replyToken?: string) {
  if (!botEnabled) {
    if (conv.status === 'BOT') await conversations.handoff(conv.id, 'Bot ปิดอยู่ ส่งเข้าคิวเจ้าหน้าที่');
    return;
  }
  if (conv.status === 'BOT' || isTrackInput(input)) await handleBot(conv, contact, input, replyToken);
}

async function ensureContact(line: LineClient, channelId: string, lineUserId: string): Promise<Contact> {
  const where = { channelId_lineUserId: { channelId, lineUserId } };
  const existing = await prisma.contact.findUnique({ where });
  if (existing?.displayName) return existing;
  const profile = await line.getProfile(lineUserId);
  return prisma.contact.upsert({
    where,
    create: { channelId, lineUserId, displayName: profile?.displayName, pictureUrl: profile?.pictureUrl },
    update: { displayName: profile?.displayName, pictureUrl: profile?.pictureUrl },
  });
}

async function toInbound(line: LineClient, m: NonNullable<LineEvent['message']>): Promise<InboundMessage> {
  const base = { type: m.type, lineMessageId: m.id };
  if (m.type === 'text') return { ...base, text: m.text };
  if (m.type === 'sticker') return { ...base, payload: { packageId: m.packageId, stickerId: m.stickerId } };
  if (m.type === 'location') {
    return {
      ...base,
      text: [m.title, m.address].filter(Boolean).join(' ') || null,
      payload: { latitude: m.latitude, longitude: m.longitude, address: m.address } as Prisma.InputJsonValue,
    };
  }
  if (MEDIA_TYPES.includes(m.type)) {
    const data = await line.getContent(m.id);
    if (!data) return { ...base, payload: { fileName: m.fileName ?? null, missing: true } };
    const saved = await saveMedia(data, extFor(m.type, m.fileName));
    return { ...base, payload: { url: saved.path, fileName: m.fileName ?? null } };
  }
  return base;
}
