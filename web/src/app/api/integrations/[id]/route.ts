import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';
import { IntegrationBody } from '@/server/integrations';

export const PUT = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req, 'ADMIN');
  const dto = await parseBody(req, IntegrationBody);
  const integration = await prisma.integration.update({ where: { id }, data: dto });
  await audit(user, 'integration.update', { type: 'integration', id }, dto);
  return integration;
});
