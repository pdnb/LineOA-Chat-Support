import { TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { requireUser } from '@/server/auth';
import { route, searchParams } from '@/server/http';
import { listTasks, taskStats } from '@/server/queue';

const Query = z.object({
  status: z.enum(TaskStatus).optional(),
  queue: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export const GET = route(async (req) => {
  await requireUser(req, 'ADMIN');
  const q = Query.parse(Object.fromEntries(searchParams(req)));
  const [page, stats] = await Promise.all([listTasks(q), taskStats()]);
  return { ...page, stats };
});
