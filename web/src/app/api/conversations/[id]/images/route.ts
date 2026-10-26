import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { ownedForReply, send } from '@/server/conversations';
import { badRequest, route } from '@/server/http';
import { saveMedia } from '@/server/media';

const MAX_BYTES = 10 * 1024 * 1024;

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  const file = (await req.formData().catch(() => null))?.get('file');
  if (!(file instanceof File) || !['image/jpeg', 'image/png'].includes(file.type)) {
    throw badRequest('รองรับเฉพาะไฟล์ JPEG หรือ PNG');
  }
  if (file.size > MAX_BYTES) throw badRequest('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
  const conv = await ownedForReply(id, user);
  const saved = await saveMedia(Buffer.from(await file.arrayBuffer()), file.type === 'image/png' ? '.png' : '.jpg');
  return send(
    conv,
    conv.contact,
    [{ type: 'image', originalContentUrl: saved.url, previewImageUrl: saved.url }],
    { senderType: 'AGENT', userId: user.id, payloads: [{ url: saved.path }] },
  );
});
