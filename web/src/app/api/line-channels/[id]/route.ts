import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';
import { LineChannelBody, toData, toPublic } from '@/server/line/channels';

/** No DELETE: contacts and conversations reference the OA, so it is switched off instead. */
export const PUT = route<{ id: string }>(async (req, { id }) => {
  const user = await requireUser(req, 'ADMIN');
  const dto = await parseBody(req, LineChannelBody);
  const channel = await prisma.lineChannel.update({ where: { id }, data: toData(dto) });
  await audit(user, 'lineChannel.update', { type: 'lineChannel', id }, dto);
  return toPublic(channel);
});
