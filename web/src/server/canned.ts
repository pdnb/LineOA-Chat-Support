import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { canSeeChannel } from './access';
import { audit } from './audit';
import { AuthUser } from './auth';
import { prisma } from './db';
import { conflict, notFound } from './http';

export const CannedReplyBody = z.object({
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9ก-๙_-]{1,30}$/, 'ใช้ได้เฉพาะ a-z 0-9 ภาษาไทย _ - ไม่เกิน 30 ตัว'),
  title: z.string().max(100).nullish(),
  text: z.string().trim().min(1).max(5000),
  /** null = every OA */
  channelId: z.string().nullish(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

type Body = z.infer<typeof CannedReplyBody>;

/** Replies the user may use: global ones plus those of their OAs, narrowed to one OA when given. */
export async function listCanned(user: AuthUser, opts: { channelId?: string | null; includeInactive?: boolean } = {}) {
  const channels =
    opts.channelId != null
      ? canSeeChannel(user, opts.channelId)
        ? [opts.channelId]
        : []
      : user.channelIds;
  const where: Prisma.CannedReplyWhereInput = {
    isActive: opts.includeInactive ? undefined : true,
    OR: [{ channelId: null }, ...(channels ? [{ channelId: { in: channels } }] : [{ channelId: { not: null } }])],
  };
  return prisma.cannedReply.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { shortcut: 'asc' }] });
}

/** A shortcut is unique within its scope: one OA, or the global (every OA) list. */
async function assertUnique(shortcut: string, channelId: string | null, exceptId?: string) {
  const dup = await prisma.cannedReply.findFirst({
    where: { shortcut, channelId, id: exceptId ? { not: exceptId } : undefined },
    select: { id: true },
  });
  if (dup) throw conflict(`มีคำสั่ง /${shortcut} อยู่แล้ว`);
}

export async function createCanned(user: AuthUser, dto: Body) {
  const channelId = dto.channelId || null;
  await assertUnique(dto.shortcut, channelId);
  const row = await prisma.cannedReply.create({ data: { ...dto, title: dto.title || null, channelId } });
  await audit(user, 'cannedReply.create', { type: 'cannedReply', id: row.id }, dto);
  return row;
}

export async function updateCanned(user: AuthUser, id: string, dto: Body) {
  if (!(await prisma.cannedReply.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
  const channelId = dto.channelId || null;
  await assertUnique(dto.shortcut, channelId, id);
  const row = await prisma.cannedReply.update({ where: { id }, data: { ...dto, title: dto.title || null, channelId } });
  await audit(user, 'cannedReply.update', { type: 'cannedReply', id }, dto);
  return row;
}

export async function deleteCanned(user: AuthUser, id: string) {
  await prisma.cannedReply.delete({ where: { id } });
  await audit(user, 'cannedReply.delete', { type: 'cannedReply', id });
}
