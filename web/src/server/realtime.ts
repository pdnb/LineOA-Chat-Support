import type { Server } from 'socket.io';
import { prisma } from './db';

export type RealtimeEvent = 'message.created' | 'conversation.updated' | 'job.updated';

interface RealtimeState {
  /** Set by the custom server once Socket.IO is attached; undefined in tests. */
  io?: Server;
  /** userId → number of open sockets. */
  online: Map<string, number>;
}

// Shared via globalThis: the socket server lives in the custom server's module graph,
// while route handlers that emit events are bundled separately by Next.
const g = globalThis as typeof globalThis & { __realtime?: RealtimeState };
export const realtime: RealtimeState = (g.__realtime ??= { online: new Map() });

/*
 * Rooms of the `/inbox` namespace: every user joins `agents` (presence), admins join
 * `admins`, and agents join `channel:<id>` for each LINE OA they are assigned to.
 */
const ADMINS_ROOM = 'admins';
const channelRoom = (channelId: string) => `channel:${channelId}`;

/** Sends to admins and to the agents of the event's LINE OA. */
export function emit(event: RealtimeEvent, data: unknown, channelId: string) {
  realtime.io?.of('/inbox').to(ADMINS_ROOM).to(channelRoom(channelId)).emit(event, data);
}

export function emitPresence() {
  realtime.io?.of('/inbox').to('agents').emit('presence', onlineUserIds());
}

export function onlineUserIds(): string[] {
  return [...realtime.online.keys()];
}

/** The data rooms (admins / channel:*) a user belongs in. */
export async function roomsFor(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, channels: { select: { id: true } } },
  });
  if (!user?.isActive) return [];
  return user.role === 'ADMIN' ? [ADMINS_ROOM] : user.channels.map((c) => channelRoom(c.id));
}

/** Re-applies a user's rooms on their open sockets after an admin changes their role or OAs. */
export async function syncUserRooms(userId: string) {
  const ns = realtime.io?.of('/inbox');
  if (!ns) return;
  const rooms = await roomsFor(userId);
  for (const socket of await ns.fetchSockets()) {
    if (socket.data.userId !== userId) continue;
    for (const room of socket.rooms) {
      if ((room === ADMINS_ROOM || room.startsWith('channel:')) && !rooms.includes(room)) socket.leave(room);
    }
    socket.join(rooms);
  }
}
