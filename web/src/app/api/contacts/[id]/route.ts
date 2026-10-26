import { z } from 'zod';
import { assertContactAccess } from '@/server/access';
import { requireUser } from '@/server/auth';
import { emitConversation, history } from '@/server/conversations';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';

const UpdateContactBody = z.object({
  displayName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  note: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
});

export const GET = route<{ id: string }>(async (req, { id }) => {
  await assertContactAccess(await requireUser(req), id);
  const contact = await prisma.contact.findUniqueOrThrow({
    where: { id },
    include: { channel: { select: { id: true, name: true, basicId: true, pictureUrl: true } } },
  });
  const [conversations, jobs] = await Promise.all([
    history(id),
    prisma.job.findMany({ where: { contactId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  return { ...contact, conversations, jobs };
});

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  await assertContactAccess(await requireUser(req), id);
  const dto = await parseBody(req, UpdateContactBody);
  const contact = await prisma.contact.update({ where: { id }, data: dto });
  const open = await prisma.conversation.findMany({ where: { contactId: id, status: { not: 'RESOLVED' } } });
  for (const c of open) await emitConversation(c.id);
  return contact;
});
