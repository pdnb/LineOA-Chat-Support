import { Role } from '@prisma/client';
import { jwtVerify, SignJWT } from 'jose';
import { prisma } from './db';
import { env } from './env';
import { forbidden, unauthorized } from './http';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** LINE OAs this user may see; null = every OA (admins). */
  channelIds: string[] | null;
}

const key = () => new TextEncoder().encode(env.jwtSecret);

export function signToken(user: { id: string; role: Role }) {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(env.jwtExpiresIn)
    .sign(key());
}

/** Returns the user id (`sub`) of a valid token; throws otherwise. */
export async function verifyToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
  if (!payload.sub) throw new Error('Token has no subject');
  return payload.sub;
}

/** Requires a valid Bearer JWT of an active user; with roles, also one of those roles. */
export async function requireUser(req: Request, ...roles: Role[]): Promise<AuthUser> {
  const [scheme, token] = (req.headers.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();
  let sub: string;
  try {
    sub = await verifyToken(token);
  } catch {
    throw unauthorized();
  }
  const user = await prisma.user.findUnique({ where: { id: sub }, include: { channels: { select: { id: true } } } });
  if (!user || !user.isActive) throw unauthorized();
  if (roles.length && !roles.includes(user.role)) throw forbidden();
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    channelIds: user.role === 'ADMIN' ? null : user.channels.map((c) => c.id),
  };
}
