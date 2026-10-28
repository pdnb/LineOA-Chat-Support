import { Prisma } from '@prisma/client';
import { prisma } from './db';

/** Keys whose values never go into the audit log. */
const SECRET_KEY = /secret|token|password|hash|authorization/i;

/** Deep copy with credential-looking keys replaced, so the audit log never stores secrets. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? (v ? '[redacted]' : v) : redact(v)]),
    );
  }
  return value;
}

/**
 * Record who did what. Never throws: a failed audit write must not fail the action itself.
 * `actor` null means the system (e.g. auto-assign).
 */
export async function audit(
  actor: { id: string } | null,
  action: string,
  entity: { type: string; id?: string | null },
  data?: unknown,
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action,
        entityType: entity.type,
        entityId: entity.id ?? null,
        data: data === undefined ? undefined : (redact(data) as Prisma.InputJsonValue),
      },
    });
  } catch (err) {
    console.error(`[audit] failed to record ${action}: ${(err as Error).message}`);
  }
}

export interface AuditFilter {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  take?: number;
  skip?: number;
}

export async function listAuditLogs(f: AuditFilter) {
  const where: Prisma.AuditLogWhereInput = {
    action: f.action ? { startsWith: f.action } : undefined,
    entityType: f.entityType || undefined,
    entityId: f.entityId || undefined,
    actorId: f.actorId || undefined,
    createdAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(f.take ?? 50, 200),
      skip: f.skip ?? 0,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total };
}
