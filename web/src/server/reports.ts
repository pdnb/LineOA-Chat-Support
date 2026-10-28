import { Prisma } from '@prisma/client';
import { prisma, utc, utcNow } from './db';

/** The report period: 1–365 days back from now (30 by default). */
export function reportWindow(daysParam?: string | null) {
  const days = Math.min(Math.max(Number(daysParam) || 30, 1), 365);
  return { days, since: new Date(Date.now() - days * 86400_000) };
}

/** Raw-SQL channel filters for `channelIds` (null = every OA). "Job" has no channel of its own: it goes through the contact. */
function scopeSql(channelIds: string[] | null) {
  const ids = channelIds ? Prisma.join(channelIds.length ? channelIds : ['__none__']) : null;
  return {
    convIn: (alias: string) => (ids ? Prisma.sql`AND ${Prisma.raw(alias)}."channelId" IN (${ids})` : Prisma.empty),
    jobIn: (alias: string) =>
      ids
        ? Prisma.sql`AND ${Prisma.raw(alias)}."contactId" IN (SELECT id FROM "Contact" WHERE "channelId" IN (${ids}))`
        : Prisma.empty,
  };
}

/** `channelIds` limits the report to those LINE OAs (null = every OA). */
export async function reportSummary(daysParam?: string | null, channelIds: string[] | null = null) {
  const { days, since } = reportWindow(daysParam);
  const channelId = channelIds ? { in: channelIds } : undefined;
  const { convIn, jobIn } = scopeSql(channelIds);

  const [convByStatus, jobByStatus, jobByCategory, response, daily, csat, csatSent] = await Promise.all([
    prisma.conversation.groupBy({ by: ['status'], where: { createdAt: { gte: since }, channelId }, _count: true }),
    prisma.job.groupBy({ by: ['status'], where: { createdAt: { gte: since }, contact: { channelId } }, _count: true }),
    prisma.$queryRaw<{ name: string | null; count: bigint }[]>`
      SELECT c.name, count(*)::bigint AS count FROM "Job" j
      LEFT JOIN "Category" c ON c.id = j."categoryId"
      WHERE j."createdAt" >= ${utc(since)} ${jobIn('j')}
      GROUP BY c.name ORDER BY count DESC`,
    prisma.$queryRaw<{ avg_seconds: number | null; handled: bigint }[]>`
      SELECT avg(extract(epoch FROM ("firstResponseAt" - "queuedAt")))::float AS avg_seconds,
             count(*)::bigint AS handled
      FROM "Conversation" cv
      WHERE "queuedAt" >= ${utc(since)} AND "firstResponseAt" IS NOT NULL
        -- Rows re-queued before the handoff fix can have queuedAt after firstResponseAt.
        AND "firstResponseAt" >= "queuedAt" ${convIn('cv')}`,
    prisma.$queryRaw<{ day: string; conversations: bigint; jobs: bigint }[]>`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM "Conversation" cv WHERE cv."createdAt"::date = d ${convIn('cv')})::bigint AS conversations,
        (SELECT count(*) FROM "Job" j WHERE j."createdAt"::date = d ${jobIn('j')})::bigint AS jobs
      FROM generate_series(${utc(since)}::date, ${utcNow}::date, interval '1 day') d
      ORDER BY d`,
    prisma.$queryRaw<{ rating: number; count: bigint }[]>`
      SELECT "csatRating" AS rating, count(*)::bigint AS count FROM "Conversation" cv
      WHERE "csatRatedAt" >= ${utc(since)} AND "csatRating" IS NOT NULL ${convIn('cv')}
      GROUP BY 1`,
    prisma.conversation.count({ where: { csatSentAt: { gte: since }, channelId } }),
  ]);

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of csat) distribution[r.rating] = Number(r.count);
  const rated = Object.values(distribution).reduce((a, b) => a + b, 0);
  const total = Object.entries(distribution).reduce((a, [r, n]) => a + Number(r) * n, 0);

  return {
    days,
    conversationsByStatus: Object.fromEntries(convByStatus.map((r) => [r.status, r._count])),
    jobsByStatus: Object.fromEntries(jobByStatus.map((r) => [r.status, r._count])),
    jobsByCategory: jobByCategory.map((r) => ({ name: r.name ?? 'ไม่ระบุหมวด', count: Number(r.count) })),
    avgFirstResponseSeconds: response[0]?.avg_seconds ?? null,
    handledConversations: Number(response[0]?.handled ?? 0),
    daily: daily.map((r) => ({ day: r.day, conversations: Number(r.conversations), jobs: Number(r.jobs) })),
    csat: { avg: rated ? total / rated : null, rated, sent: csatSent, distribution },
  };
}

export interface AgentStats {
  userId: string;
  name: string;
  isActive: boolean;
  /** Chats the agent wrote in during the period */
  handled: number;
  messagesSent: number;
  resolved: number;
  avgFirstResponseSeconds: number | null;
  /** queuedAt (or createdAt) → resolvedAt, for chats this agent closed */
  avgResolutionSeconds: number | null;
  csatAvg: number | null;
  csatCount: number;
}

/** Per-agent performance over the period, within `channelIds`; `onlyUserId` limits it to one agent. */
export async function agentStats(
  daysParam?: string | null,
  channelIds: string[] | null = null,
  onlyUserId?: string,
): Promise<{ days: number; agents: AgentStats[] }> {
  const { days, since } = reportWindow(daysParam);
  const { convIn } = scopeSql(channelIds);
  const only = (col: string) => (onlyUserId ? Prisma.sql`AND ${Prisma.raw(col)} = ${onlyUserId}` : Prisma.empty);

  const [sent, frt, res] = await Promise.all([
    prisma.$queryRaw<{ uid: string; handled: bigint; messages: bigint }[]>`
      SELECT m."senderUserId" AS uid, count(DISTINCT m."conversationId")::bigint AS handled, count(*)::bigint AS messages
      FROM "Message" m JOIN "Conversation" cv ON cv.id = m."conversationId"
      WHERE m."senderType" = 'AGENT' AND m."senderUserId" IS NOT NULL AND m."createdAt" >= ${utc(since)}
        ${convIn('cv')} ${only('m."senderUserId"')}
      GROUP BY 1`,
    prisma.$queryRaw<{ uid: string; avg: number | null }[]>`
      SELECT "firstResponderId" AS uid, avg(extract(epoch FROM ("firstResponseAt" - "queuedAt")))::float AS avg
      FROM "Conversation" cv
      WHERE "firstResponderId" IS NOT NULL AND "firstResponseAt" >= ${utc(since)} AND "firstResponseAt" >= "queuedAt"
        ${convIn('cv')} ${only('cv."firstResponderId"')}
      GROUP BY 1`,
    prisma.$queryRaw<{ uid: string; resolved: bigint; avg: number | null; csat_avg: number | null; csat_count: bigint }[]>`
      SELECT "resolvedById" AS uid, count(*)::bigint AS resolved,
             avg(extract(epoch FROM ("resolvedAt" - COALESCE("queuedAt", "createdAt"))))::float AS avg,
             avg("csatRating")::float AS csat_avg, count("csatRating")::bigint AS csat_count
      FROM "Conversation" cv
      WHERE "resolvedById" IS NOT NULL AND "resolvedAt" >= ${utc(since)} ${convIn('cv')} ${only('cv."resolvedById"')}
      GROUP BY 1`,
  ]);

  const ids = new Set([...sent, ...frt, ...res].map((r) => r.uid));
  const users = await prisma.user.findMany({
    where: onlyUserId ? { id: onlyUserId } : { OR: [{ id: { in: [...ids] } }, { isActive: true }] },
    select: { id: true, name: true, isActive: true },
    orderBy: { name: 'asc' },
  });
  const by = <T extends { uid: string }>(rows: T[]) => new Map(rows.map((r) => [r.uid, r]));
  const s = by(sent);
  const f = by(frt);
  const r = by(res);
  const agents = users.map((u) => ({
    userId: u.id,
    name: u.name,
    isActive: u.isActive,
    handled: Number(s.get(u.id)?.handled ?? 0),
    messagesSent: Number(s.get(u.id)?.messages ?? 0),
    resolved: Number(r.get(u.id)?.resolved ?? 0),
    avgFirstResponseSeconds: f.get(u.id)?.avg ?? null,
    avgResolutionSeconds: r.get(u.id)?.avg ?? null,
    csatAvg: r.get(u.id)?.csat_avg ?? null,
    csatCount: Number(r.get(u.id)?.csat_count ?? 0),
  }));
  agents.sort((a, b) => b.handled - a.handled || a.name.localeCompare(b.name));
  return { days, agents };
}
