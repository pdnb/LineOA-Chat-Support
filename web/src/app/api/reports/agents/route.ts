import { requireUser } from '@/server/auth';
import { route, searchParams } from '@/server/http';
import { agentStats } from '@/server/reports';

/** Admins see every agent; an agent sees only their own row. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  return agentStats(searchParams(req).get('days'), user.channelIds, user.role === 'ADMIN' ? undefined : user.id);
});
