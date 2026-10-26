import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';
import { IntegrationBody, newSecret } from '@/server/integrations';
import { callbackUrl } from '@/server/jobs';

export const GET = route(async (req) => {
  await requireUser(req, 'ADMIN');
  const rows = await prisma.integration.findMany({ orderBy: { name: 'asc' } });
  return rows.map((r) => ({ ...r, callbackUrl: callbackUrl(r.id) }));
});

export const POST = route(async (req) => {
  await requireUser(req, 'ADMIN');
  const dto = await parseBody(req, IntegrationBody);
  return prisma.integration.create({ data: { ...dto, secret: dto.secret ?? newSecret() } });
});
