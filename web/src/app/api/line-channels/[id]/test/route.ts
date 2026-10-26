import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { route } from '@/server/http';
import { getChannel } from '@/server/line/channels';
import { getLineClient } from '@/server/line/client';

/** Checks the access token by reading the bot info, and keeps the OA's basic id / picture from it. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireUser(req, 'ADMIN');
  await getChannel(id);
  try {
    const info = await (await getLineClient(id)).getBotInfo();
    await prisma.lineChannel.update({
      where: { id },
      data: { botUserId: info.userId, basicId: info.basicId, pictureUrl: info.pictureUrl ?? null },
    });
    return { ok: true, displayName: info.displayName, basicId: info.basicId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});
