import { Prisma, PrismaClient } from '@prisma/client';

// Route handlers (bundled by Next) and the custom server load separate module copies,
// so the client lives on globalThis to keep a single connection pool per process.
const g = globalThis as typeof globalThis & { __prisma?: PrismaClient };

export const prisma: PrismaClient = (g.__prisma ??= new PrismaClient());

/**
 * A Date as a raw-SQL value comparable with Prisma's DateTime columns, which are `timestamp` (no time
 * zone) holding UTC. A bare Date parameter is converted with the session time zone, so on a server
 * whose time zone isn't UTC (e.g. Asia/Bangkok) comparisons and writes would be off by hours.
 */
export const utc = (d: Date) => Prisma.sql`(${d}::timestamptz AT TIME ZONE 'UTC')`;

/** The current time in the same form (use instead of a bare `now()` next to those columns). */
export const utcNow = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
