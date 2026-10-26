import { assertJobAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { route } from '@/server/http';
import { getJob } from '@/server/jobs';

export const GET = route<{ id: string }>(async (req, { id }) => {
  await assertJobAccess(await requireUser(req), id);
  return getJob(id);
});
