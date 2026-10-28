import { prisma, utc } from './db';
import { emit } from './realtime';
import { getSetting } from './settings';

export interface SlaBreach {
  id: string;
  channelId: string;
  kind: 'queue' | 'response';
  since: Date;
  contactName: string | null;
}

/**
 * Find chats past their SLA and alert their OA's agents and admins, once per wait: the alert is claimed
 * atomically (`slaAlertedAt`), so several workers never send it twice. Assign, handoff, transfer and
 * reopen clear the flag, which starts a new wait.
 */
export async function checkSla(now = new Date()): Promise<SlaBreach[]> {
  const cfg = await getSetting('sla');
  if (!cfg.enabled) return [];
  const queueCutoff = new Date(now.getTime() - cfg.queueWaitMinutes * 60_000);
  const responseCutoff = new Date(now.getTime() - cfg.firstResponseMinutes * 60_000);
  const rows = await prisma.$queryRaw<
    { id: string; channelId: string; status: string; waitingSince: Date | null; queuedAt: Date | null; contactName: string | null }[]
  >`
    UPDATE "Conversation" cv SET "slaAlertedAt" = ${utc(now)}
    FROM "Contact" ct
    WHERE ct.id = cv."contactId" AND cv."slaAlertedAt" IS NULL AND (
      (cv.status = 'QUEUED' AND COALESCE(cv."waitingSince", cv."queuedAt") < ${utc(queueCutoff)}) OR
      (cv.status = 'ASSIGNED' AND cv."firstResponseAt" IS NULL AND cv."queuedAt" < ${utc(responseCutoff)}))
    RETURNING cv.id, cv."channelId", cv.status, cv."waitingSince", cv."queuedAt", ct."displayName" AS "contactName"`;
  const breaches = rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    kind: r.status === 'QUEUED' ? ('queue' as const) : ('response' as const),
    since: (r.status === 'QUEUED' ? (r.waitingSince ?? r.queuedAt) : r.queuedAt)!,
    contactName: r.contactName,
  }));
  for (const b of breaches) {
    const minutes = Math.floor((now.getTime() - b.since.getTime()) / 60_000);
    emit('sla.breached', { conversationId: b.id, kind: b.kind, minutes, contactName: b.contactName }, b.channelId);
  }
  return breaches;
}
