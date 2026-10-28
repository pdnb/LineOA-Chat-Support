import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { route } from '@/server/http';
import { newSecret } from '@/server/integrations';

export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req, 'ADMIN');
  const integration = await prisma.integration.update({ where: { id }, data: { secret: newSecret() } });
  await audit(user, 'integration.rotateSecret', { type: 'integration', id });
  return integration;
});
