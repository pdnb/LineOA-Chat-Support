import { Prisma } from '@prisma/client';
import { prisma } from './db';

/** `channelIds` limits the report to those LINE OAs (null = every OA). */
export async function reportSummary(daysParam?: string | null, channelIds: string[] | null = null) {
  const days = Math.min(Math.max(Number(daysParam) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86400_000);
  const channelId = channelIds ? { in: channelIds } : undefined;
  // Raw-SQL equivalents of the channel filter ("Job" has no channel of its own: it goes through the contact).
  const ids = channelIds ? Prisma.join(channelIds.length ? channelIds : ['__none__']) : null;
  const convIn = (alias: string) => (ids ? Prisma.sql`AND ${Prisma.raw(alias)}."channelId" IN (${ids})` : Prisma.empty);
  const jobIn = (alias: string) =>
    ids
      ? Prisma.sql`AND ${Prisma.raw(alias)}."contactId" IN (SELECT id FROM "Contact" WHERE "channelId" IN (${ids}))`
      : Prisma.empty;

  const [convByStatus, jobByStatus, jobByCategory, response, daily] = await Promise.all([
    prisma.conversation.groupBy({ by: ['status'], where: { createdAt: { gte: since }, channelId }, _count: true }),
    prisma.job.groupBy({ by: ['status'], where: { createdAt: { gte: since }, contact: { channelId } }, _count: true }),
    prisma.$queryRaw<{ name: string | null; count: bigint }[]>`
      SELECT c.name, count(*)::bigint AS count FROM "Job" j
      LEFT JOIN "Category" c ON c.id = j."categoryId"
      WHERE j."createdAt" >= ${since} ${jobIn('j')}
      GROUP BY c.name ORDER BY count DESC`,
    prisma.$queryRaw<{ avg_seconds: number | null; handled: bigint }[]>`
      SELECT avg(extract(epoch FROM ("firstResponseAt" - "queuedAt")))::float AS avg_seconds,
             count(*)::bigint AS handled
      FROM "Conversation" cv
      WHERE "queuedAt" >= ${since} AND "firstResponseAt" IS NOT NULL
        -- Rows re-queued before the handoff fix can have queuedAt after firstResponseAt.
        AND "firstResponseAt" >= "queuedAt" ${convIn('cv')}`,
    prisma.$queryRaw<{ day: string; conversations: bigint; jobs: bigint }[]>`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM "Conversation" cv WHERE cv."createdAt"::date = d ${convIn('cv')})::bigint AS conversations,
        (SELECT count(*) FROM "Job" j WHERE j."createdAt"::date = d ${jobIn('j')})::bigint AS jobs
      FROM generate_series(${since}::date, now()::date, interval '1 day') d
      ORDER BY d`,
  ]);

  return {
    days,
    conversationsByStatus: Object.fromEntries(convByStatus.map((r) => [r.status, r._count])),
    jobsByStatus: Object.fromEntries(jobByStatus.map((r) => [r.status, r._count])),
    jobsByCategory: jobByCategory.map((r) => ({ name: r.name ?? 'ไม่ระบุหมวด', count: Number(r.count) })),
    avgFirstResponseSeconds: response[0]?.avg_seconds ?? null,
    handledConversations: Number(response[0]?.handled ?? 0),
    daily: daily.map((r) => ({ day: r.day, conversations: Number(r.conversations), jobs: Number(r.jobs) })),
  };
}
