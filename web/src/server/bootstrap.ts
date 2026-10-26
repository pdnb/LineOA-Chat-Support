import bcrypt from 'bcryptjs';
import { prisma } from './db';

/**
 * Production first run: creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD when the database
 * has no users yet (the dev seed does this otherwise). A no-op once any user exists.
 */
export async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if ((await prisma.user.count()) > 0) return;
  await prisma.user.create({
    data: { email, name: 'ผู้ดูแลระบบ', role: 'ADMIN', passwordHash: await bcrypt.hash(password, 10) },
  });
  console.log(`> Created admin ${email}`);
}
