import { PrismaClient } from '@prisma/client';

// Route handlers (bundled by Next) and the custom server load separate module copies,
// so the client lives on globalThis to keep a single connection pool per process.
const g = globalThis as typeof globalThis & { __prisma?: PrismaClient };

export const prisma: PrismaClient = (g.__prisma ??= new PrismaClient());
