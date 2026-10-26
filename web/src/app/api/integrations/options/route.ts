import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { route } from '@/server/http';

/** Target list for the create-job form; agents may read it but not see secrets. */
export const GET = route(async (req) => {
  await requireUser(req, 'ADMIN', 'AGENT');
  return prisma.integration.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
});
