import { z } from 'zod';
import { listAuditLogs } from '@/server/audit';
import { requireUser } from '@/server/auth';
import { route, searchParams } from '@/server/http';

const Query = z.object({
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export const GET = route(async (req) => {
  await requireUser(req, 'ADMIN');
  return listAuditLogs(Query.parse(Object.fromEntries(searchParams(req))));
});
