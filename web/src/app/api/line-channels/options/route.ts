import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { route } from '@/server/http';

/** The OAs the current user may see (inbox filter, user form); no credentials. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  return prisma.lineChannel.findMany({
    where: user.channelIds ? { id: { in: user.channelIds } } : {},
    select: { id: true, name: true, basicId: true, pictureUrl: true, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
});
