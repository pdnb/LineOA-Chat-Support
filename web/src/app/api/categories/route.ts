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
  await requireUser(req, 'ADMIN');
  return prisma.category.create({ data: await parseBody(req, CategoryBody) });
});
