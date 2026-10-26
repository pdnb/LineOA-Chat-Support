import { prisma } from '@/server/db';
import { route } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  await prisma.$queryRaw`SELECT 1`;
  const failedTasks = await prisma.queueTask.count({ where: { status: 'FAILED' } });
  const pendingTasks = await prisma.queueTask.count({ where: { status: 'PENDING' } });
  return { ok: true, pendingTasks, failedTasks };
});
