import { requireUser } from '@/server/auth';
import { CategoryBody } from '@/server/categories';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';

export const PUT = route<{ id: string }>(async (req, { id }) => {
  await requireUser(req, 'ADMIN');
  return prisma.category.update({ where: { id }, data: await parseBody(req, CategoryBody) });
});

/** Categories referenced by jobs or chats are deactivated instead of deleted. */
export const DELETE = route<{ id: string }>(async (req, { id }) => {
  await requireUser(req, 'ADMIN');
  const used =
    (await prisma.job.count({ where: { categoryId: id } })) +
    (await prisma.conversation.count({ where: { categoryId: id } }));
  if (used) return prisma.category.update({ where: { id }, data: { isActive: false } });
  return prisma.category.delete({ where: { id } });
});
