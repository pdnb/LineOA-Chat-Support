import { z } from 'zod';
import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { parseBody, route } from '@/server/http';
import { retryFailed } from '@/server/queue';

const Body = z.object({ queue: z.string().optional() });

export const POST = route(async (req) => {
  const user = await requireUser(req, 'ADMIN');
  const { queue } = await parseBody(req, Body);
  const count = await retryFailed(queue);
  await audit(user, 'queue.retryFailed', { type: 'queueTask' }, { queue, count });
  return { count };
});
