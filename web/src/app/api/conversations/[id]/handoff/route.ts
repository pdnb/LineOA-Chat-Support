import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { handoff } from '@/server/conversations';
import { route } from '@/server/http';

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  return handoff(id, `${user.name} ส่งเรื่องกลับเข้าคิว`);
});
