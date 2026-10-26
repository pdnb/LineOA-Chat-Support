import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';
import { IntegrationBody } from '@/server/integrations';

export const PUT = route<{ id: string }>(async (req, { id }) => {
  await requireUser(req, 'ADMIN');
  return prisma.integration.update({ where: { id }, data: await parseBody(req, IntegrationBody) });
});
