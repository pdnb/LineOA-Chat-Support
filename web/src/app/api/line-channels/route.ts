import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';
import { LineChannelBody, toData, toPublic } from '@/server/line/channels';

export const GET = route(async (req) => {
  await requireUser(req, 'ADMIN');
  const rows = await prisma.lineChannel.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map(toPublic);
});

export const POST = route(async (req) => {
  const user = await requireUser(req, 'ADMIN');
  const dto = await parseBody(req, LineChannelBody);
  const channel = await prisma.lineChannel.create({ data: toData(dto) });
  await audit(user, 'lineChannel.create', { type: 'lineChannel', id: channel.id }, dto);
  return toPublic(channel);
});
