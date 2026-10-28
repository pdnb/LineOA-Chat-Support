import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { reopen } from '@/server/conversations';
import { route } from '@/server/http';

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  return reopen(id, user);
});
