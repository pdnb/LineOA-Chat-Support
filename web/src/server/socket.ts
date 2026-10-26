import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { verifyToken } from './auth';
import { prisma } from './db';
import { emitPresence, realtime, roomsFor } from './realtime';

/** Realtime channel to the agent console, attached to the custom server's HTTP server. */
export function attachSocket(httpServer: HttpServer) {
  // destroyUpgrade=false leaves other upgrade requests (Next's HMR socket) alone.
  const io = new Server(httpServer, { destroyUpgrade: false });
  realtime.io = io;

  io.of('/inbox').on('connection', async (client) => {
    let userId: string;
    try {
      userId = await verifyToken((client.handshake.auth?.token as string | undefined) ?? '');
    } catch {
      client.disconnect(true);
      return;
    }
    client.data.userId = userId;
    await client.join(['agents', ...(await roomsFor(userId))]);
    realtime.online.set(userId, (realtime.online.get(userId) ?? 0) + 1);
    await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    emitPresence();

    client.on('disconnect', async () => {
      const left = (realtime.online.get(userId) ?? 1) - 1;
      if (left <= 0) realtime.online.delete(userId);
      else realtime.online.set(userId, left);
      await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
      emitPresence();
    });
  });

  return io;
}
