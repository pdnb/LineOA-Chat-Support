import { assertConversationAccess } from '@/server/access';
import { sendAttachment } from '@/server/attachments';
import { requireUser } from '@/server/auth';
import { ownedForReply } from '@/server/conversations';
import { badRequest, route } from '@/server/http';

/**
 * Multipart: `file`, plus `preview` (a JPEG frame, for video) and `duration` (ms, required for audio).
 * Documents reach the customer as a download link (LINE can't receive files from an OA).
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw badRequest('ไม่พบไฟล์');
  const preview = form?.get('preview');
  const conv = await ownedForReply(id, user);
  return sendAttachment(conv, conv.contact, user.id, file, {
    preview: preview instanceof File ? preview : null,
    durationMs: Number(form?.get('duration')) || null,
  });
});
