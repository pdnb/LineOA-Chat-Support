import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { route } from '@/server/http';
import { newSecret } from '@/server/integrations';

export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireUser(req, 'ADMIN');
  return prisma.integration.update({ where: { id }, data: { secret: newSecret() } });
});
