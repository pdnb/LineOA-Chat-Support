import { Prisma } from '@prisma/client';
import { canSeeChannel } from './access';
import { AuthUser } from './auth';
import { prisma } from './db';

/** Distinct contact tags within the OAs the user may see (narrowed to one OA when given). */
export async function tagsFor(user: Pick<AuthUser, 'channelIds'>, channelId?: string | null): Promise<string[]> {
  let ids: string[] | null = user.channelIds;
  if (channelId) ids = canSeeChannel(user, channelId) ? [channelId] : [];
  if (ids && !ids.length) return [];
  const scope = ids ? Prisma.sql`WHERE "channelId" IN (${Prisma.join(ids)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ tag: string }[]>`
    SELECT DISTINCT unnest(tags) AS tag FROM "Contact" ${scope} ORDER BY 1 LIMIT 500`;
  return rows.map((r) => r.tag);
}
