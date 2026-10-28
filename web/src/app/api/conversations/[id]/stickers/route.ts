import { z } from 'zod';
import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { ownedForReply, send } from '@/server/conversations';
import { badRequest, parseBody, route } from '@/server/http';
import { isSendableSticker } from '@/lib/stickers';

const StickerBody = z.object({ packageId: z.coerce.string(), stickerId: z.coerce.string() });

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  const { packageId, stickerId } = await parseBody(req, StickerBody);
  if (!isSendableSticker(packageId, stickerId)) throw badRequest('สติกเกอร์นี้ส่งผ่าน LINE OA ไม่ได้');
  const conv = await ownedForReply(id, user);
  return send(conv, conv.contact, [{ type: 'sticker', packageId, stickerId }], { senderType: 'AGENT', userId: user.id });
});
