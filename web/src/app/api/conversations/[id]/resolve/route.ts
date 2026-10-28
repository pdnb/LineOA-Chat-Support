import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { resolve } from '@/server/conversations';
import { requestCsat } from '@/server/csat';
import { route } from '@/server/http';

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  const conv = await resolve(id, user);
  await requestCsat(conv.id);
  return conv;
});
