import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { route } from '@/server/http';
import { retryTask } from '@/server/queue';

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req, 'ADMIN');
  await retryTask(id);
  await audit(user, 'queue.retry', { type: 'queueTask', id });
});
