import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { route } from '@/server/http';
import { deleteTask } from '@/server/queue';

export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req, 'ADMIN');
  await deleteTask(id);
  await audit(user, 'queue.delete', { type: 'queueTask', id });
});
