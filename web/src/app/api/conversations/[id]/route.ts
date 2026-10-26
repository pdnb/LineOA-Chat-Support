import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { detail } from '@/server/conversations';
import { route } from '@/server/http';

export const GET = route<{ id: string }>(async (req, { id }) => {
  await assertConversationAccess(await requireUser(req), id);
  return detail(id);
});
