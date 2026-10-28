import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { CategoryBody } from '@/server/categories';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';

export const PUT = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req, 'ADMIN');
  const dto = await parseBody(req, CategoryBody);
  const category = await prisma.category.update({ where: { id }, data: dto });
  await audit(user, 'category.update', { type: 'category', id }, dto);
  return category;
});

/** Categories referenced by jobs or chats are deactivated instead of deleted. */
export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req, 'ADMIN');
  await audit(user, 'category.delete', { type: 'category', id });
  const used =
    (await prisma.job.count({ where: { categoryId: id } })) +
    (await prisma.conversation.count({ where: { categoryId: id } }));
  if (used) return prisma.category.update({ where: { id }, data: { isActive: false } });
  return prisma.category.delete({ where: { id } });
});
