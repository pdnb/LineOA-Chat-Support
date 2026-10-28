import { z } from 'zod';
import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { transfer } from '@/server/conversations';
import { parseBody, route } from '@/server/http';

const TransferBody = z.object({ userId: z.string().min(1), note: z.string().max(500).optional() });

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  const dto = await parseBody(req, TransferBody);
  return transfer(id, dto.userId, user, dto.note);
});
