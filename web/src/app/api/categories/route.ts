import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { CategoryBody } from '@/server/categories';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';

export const GET = route(async (req) => {
  await requireUser(req);
  return prisma.category.findMany({
    include: { integration: { select: { id: true, name: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
});

export const POST = route(async (req) => {
  const user = await requireUser(req, 'ADMIN');
  const dto = await parseBody(req, CategoryBody);
  const category = await prisma.category.create({ data: dto });
  await audit(user, 'category.create', { type: 'category', id: category.id }, dto);
  return category;
});
