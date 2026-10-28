import { z } from 'zod';
import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { listMessages, ownedForReply, send } from '@/server/conversations';
import { parseBody, route, searchParams } from '@/server/http';

const SendTextBody = z.object({ text: z.string().min(1).max(5000) });

/** Older history: `?before=<messageId>` returns the page just before that message, oldest first. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  await assertConversationAccess(await requireUser(req), id);
  const params = searchParams(req);
  return listMessages(id, { before: params.get('before'), limit: Number(params.get('limit')) || undefined });
});

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  const dto = await parseBody(req, SendTextBody);
  const conv = await ownedForReply(id, user);
  return send(conv, conv.contact, [{ type: 'text', text: dto.text }], { senderType: 'AGENT', userId: user.id });
});
