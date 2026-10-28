import { z } from 'zod';
import { assertConversationAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { assign } from '@/server/conversations';
import { forbidden, parseBody, route } from '@/server/http';

const AssignBody = z.object({ userId: z.string().optional() });

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req);
  await assertConversationAccess(user, id);
  const dto = await parseBody(req, AssignBody);
  if (dto.userId && dto.userId !== user.id && user.role !== 'ADMIN') {
    throw forbidden('เฉพาะผู้ดูแลระบบที่มอบหมายงานให้ผู้อื่นได้');
  }
  return assign(id, dto.userId ?? user.id, user);
});
