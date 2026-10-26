import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { route } from '@/server/http';
import { pingIntegration } from '@/server/jobs';

export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireUser(req, 'ADMIN');
  return pingIntegration(await prisma.integration.findUniqueOrThrow({ where: { id } }));
});
