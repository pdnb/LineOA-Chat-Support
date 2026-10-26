import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { markRead } from '@/server/conversations';
import { route } from '@/server/http';

export const POST = route<{ id: string }>(async (req, { id }) => {
  await assertConversationAccess(await requireUser(req), id);
  await markRead(id);
});
