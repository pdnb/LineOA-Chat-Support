import * as conversations from './conversations';
import { prisma } from './db';
import { LineMessage } from './line/client';
import { LINE_PUSH_QUEUE } from './notifications';
import { enqueue } from './queue';
import { getSetting } from './settings';
import { truncate } from './text';

/*
 * Customer satisfaction: when an agent resolves a chat on an OA with csatEnabled, the customer gets a
 * card with 1–5 buttons. The tap comes back as a postback `action=csat&c=<conversationId>&r=<rating>`.
 */

/** Ratings older than this are ignored (old cards stay tappable in LINE forever). */
const CSAT_WINDOW_MS = 7 * 86400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATING_COLORS = ['#DC2626', '#EA580C', '#CA8A04', '#65A30D', '#16A34A'];

export function csatFlex(conversationId: string, question: string): LineMessage {
  return {
    type: 'flex',
    altText: truncate(question, 400),
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: 'ประเมินความพึงพอใจ', size: 'sm', color: '#64748B' },
          { type: 'text', text: truncate(question, 300), wrap: true, weight: 'bold' },
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [1, 2, 3, 4, 5].map((r) => ({
              type: 'button',
              style: 'primary',
              height: 'sm',
              color: RATING_COLORS[r - 1],
              action: { type: 'postback', label: String(r), data: `action=csat&c=${conversationId}&r=${r}`, displayText: `⭐ ${r}` },
            })),
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ไม่พอใจ', size: 'xs', color: '#94A3B8' },
              { type: 'text', text: 'พอใจมาก', size: 'xs', color: '#94A3B8', align: 'end' },
            ],
          },
        ],
      },
    },
  } as LineMessage;
}

export function parseCsatPostback(data: string): { conversationId: string; rating: number } | null {
  const p = new URLSearchParams(data);
  if (p.get('action') !== 'csat') return null;
  const conversationId = p.get('c') ?? '';
  const rating = Number(p.get('r'));
  if (!UUID.test(conversationId) || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  return { conversationId, rating };
}

/** Queue the rating card after a resolve: only on OAs that opted in, once, and only if an agent actually answered. */
export async function requestCsat(conversationId: string) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: { select: { csatEnabled: true } } },
  });
  if (!conv || conv.status !== 'RESOLVED' || !conv.channel.csatEnabled || conv.csatSentAt || !conv.firstResponseAt) return;
  await prisma.conversation.update({ where: { id: conv.id }, data: { csatSentAt: new Date() } });
  await enqueue(LINE_PUSH_QUEUE, {
    contactId: conv.contactId,
    conversationId: conv.id,
    messages: [csatFlex(conv.id, await getSetting('csat.question'))],
  });
}

/**
 * Store a rating tapped by the customer `(channelId, lineUserId)`. The first rating wins; taps on
 * another customer's card or on a card older than the window are ignored. Returns whether it was handled.
 */
export async function recordCsat(
  channelId: string,
  lineUserId: string,
  rating: { conversationId: string; rating: number },
  replyToken?: string,
) {
  const conv = await prisma.conversation.findUnique({ where: { id: rating.conversationId }, include: { contact: true } });
  if (!conv || conv.channelId !== channelId || conv.contact.lineUserId !== lineUserId) return;
  if (!conv.csatSentAt || Date.now() - conv.csatSentAt.getTime() > CSAT_WINDOW_MS) return;
  if (conv.csatRating == null) {
    const { count } = await prisma.conversation.updateMany({
      where: { id: conv.id, csatRating: null },
      data: { csatRating: rating.rating, csatRatedAt: new Date() },
    });
    if (count) await conversations.recordSystem(conv, `ลูกค้าให้คะแนนความพึงพอใจ ${rating.rating}/5`);
  }
  await conversations.send(conv, conv.contact, [{ type: 'text', text: await getSetting('csat.thanks') }], {
    replyToken,
    senderType: 'BOT',
  });
  await conversations.emitConversation(conv.id);
}
