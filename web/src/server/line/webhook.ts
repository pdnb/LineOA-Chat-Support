import { prisma } from '../db';
import { verifyLineSignature } from '../hmac';
import { notFound, unauthorized } from '../http';
import { enqueue } from '../queue';
import { LINE_EVENTS_QUEUE, LineEvent, LineEventTask } from './events';

/** LINE expects a fast 200: events are persisted to the queue and processed asynchronously. */
export async function receiveWebhook(req: Request, channelId: string) {
  const channel = await prisma.lineChannel.findUnique({ where: { id: channelId } });
  if (!channel) throw notFound('Unknown LINE channel');
  const raw = await req.text();
  if (channel.channelSecret) {
    if (!verifyLineSignature(raw, channel.channelSecret, req.headers.get('x-line-signature') ?? undefined)) {
      throw unauthorized('Invalid LINE signature');
    }
  } else {
    console.warn(`[webhooks/line] channel "${channel.name}" has no channel secret — accepting webhook without signature check (dev only)`);
  }
  // Answer 200 for a disabled OA so LINE doesn't keep redelivering; its events are dropped.
  if (!channel.isActive) return Response.json({ ok: true, ignored: true });
  const body = (raw ? JSON.parse(raw) : {}) as { events?: LineEvent[] };
  for (const event of body.events ?? []) {
    await enqueue(LINE_EVENTS_QUEUE, { channelId, event } satisfies LineEventTask, { maxAttempts: 3 });
  }
  return Response.json({ ok: true });
}
