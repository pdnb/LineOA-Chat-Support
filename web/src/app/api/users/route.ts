import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { audit } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseBody, route } from '@/server/http';
import { onlineUserIds } from '@/server/realtime';
import { toUserDto, USER_SELECT } from '@/server/users';

const CreateUserBody = z.object({
  email: z.email(),
  name: z.string().min(1).max(100),
  /** Omit for an Auth0-only account */
  password: z.string().min(8).optional(),
  role: z.enum(Role).optional(),
  /** LINE OAs the agent handles (ignored for admins, who see every OA) */
  channelIds: z.array(z.string()).optional(),
});

/** Any agent can list users (needed for assignment); only admins can change them. */
export const GET = route(async (req) => {
  await requireUser(req);
  const users = await prisma.user.findMany({ select: USER_SELECT, orderBy: { name: 'asc' } });
  const online = new Set(onlineUserIds());
  return users.map((u) => ({ ...toUserDto(u), online: online.has(u.id) }));
});

export const POST = route(async (req) => {
  const admin = await requireUser(req, 'ADMIN');
  const dto = await parseBody(req, CreateUserBody);
  const user = await prisma.user.create({
    data: {
      email: dto.email.toLowerCase(),
      name: dto.name,
      role: dto.role ?? 'AGENT',
      passwordHash: dto.password ? await bcrypt.hash(dto.password, 10) : null,
      channels: { connect: (dto.channelIds ?? []).map((id) => ({ id })) },
    },
    select: USER_SELECT,
  });
  await audit(admin, 'user.create', { type: 'user', id: user.id }, dto);
  return toUserDto(user);
});
