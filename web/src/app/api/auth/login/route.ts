import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { signToken } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseBody, route, unauthorized } from '@/server/http';

const LoginBody = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const POST = route(async (req) => {
  const dto = await parseBody(req, LoginBody);
  const user = await prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
  // Auth0-only accounts have no password hash.
  if (!user || !user.isActive || !user.passwordHash || !(await bcrypt.compare(dto.password, user.passwordHash))) {
    throw unauthorized('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  const token = await signToken(user);
  return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
});
