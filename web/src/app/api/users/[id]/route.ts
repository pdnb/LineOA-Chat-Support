import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';
import { syncUserRooms } from '@/server/realtime';
import { toUserDto, USER_SELECT } from '@/server/users';

const UpdateUserBody = z.object({
  name: z.string().min(1).max(100).optional(),
  password: z.string().min(8).optional(),
  role: z.enum(Role).optional(),
  isActive: z.boolean().optional(),
  channelIds: z.array(z.string()).optional(),
});

export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const admin = await requireUser(req, 'ADMIN');
  const { password, channelIds, ...rest } = await parseBody(req, UpdateUserBody);
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...rest,
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      ...(channelIds ? { channels: { set: channelIds.map((cid) => ({ id: cid })) } } : {}),
    },
    select: USER_SELECT,
  });
  // Open consoles start/stop receiving the affected OAs' realtime events right away.
  await syncUserRooms(id);
  await audit(admin, 'user.update', { type: 'user', id }, { ...rest, channelIds, passwordChanged: !!password || undefined });
  return toUserDto(user);
});
