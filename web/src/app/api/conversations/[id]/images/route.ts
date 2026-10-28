import { assertConversationAccess } from '@/server/access';
import { kindOf, sendAttachment } from '@/server/attachments';
import { requireUser } from '@/server/auth';
import { ownedForReply } from '@/server/conversations';
import { badRequest, route } from '@/server/http';

/** Image-only upload, kept for older clients; the console uses /attachments. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  const file = (await req.formData().catch(() => null))?.get('file');
  if (!(file instanceof File) || kindOf(file) !== 'image') throw badRequest('รองรับเฉพาะไฟล์ JPEG หรือ PNG');
  const conv = await ownedForReply(id, user);
  return sendAttachment(conv, conv.contact, user.id, file);
});
