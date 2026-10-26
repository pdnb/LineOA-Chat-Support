import { z } from 'zod';
import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { ownedForReply, send } from '@/server/conversations';
import { parseBody, route } from '@/server/http';

const SendTextBody = z.object({ text: z.string().min(1).max(5000) });

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  const dto = await parseBody(req, SendTextBody);
  const conv = await ownedForReply(id, user);
  return send(conv, conv.contact, [{ type: 'text', text: dto.text }], { senderType: 'AGENT', userId: user.id });
});
