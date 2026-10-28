import { z } from 'zod';
import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { parseBody, route } from '@/server/http';
import { cleanupDone } from '@/server/queue';

const Body = z.object({ olderThanDays: z.number().int().min(0).max(3650) });

/** Delete finished (DONE) tasks older than N days. */
export const POST = route(async (req) => {
  const user = await requireUser(req, 'ADMIN');
  const { olderThanDays } = await parseBody(req, Body);
  const count = await cleanupDone(new Date(Date.now() - olderThanDays * 86400_000));
  await audit(user, 'queue.purge', { type: 'queueTask' }, { olderThanDays, count });
  return { count };
});
