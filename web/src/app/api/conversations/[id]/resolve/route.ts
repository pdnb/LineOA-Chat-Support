import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { resolve } from '@/server/conversations';
import { route } from '@/server/http';

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  return resolve(id, user.name);
});
