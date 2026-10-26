import { assertJobAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { route } from '@/server/http';
import { dispatchJob, getJob } from '@/server/jobs';

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertJobAccess(user, id);
  await dispatchJob(id, user.id);
  return getJob(id);
});
