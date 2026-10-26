import { JobPriority, JobStatus } from '@prisma/client';
import { z } from 'zod';
import { assertContactAccess, channelScope } from '@/server/access';
import { requireUser } from '@/server/auth';
import { parseBody, route, searchParams } from '@/server/http';
import { createJob, listJobs } from '@/server/jobs';

const CreateJobBody = z.object({
  contactId: z.string(),
  conversationId: z.string().optional(),
  categoryId: z.string().optional(),
  integrationId: z.string().optional(),
  title: z.string().min(1).max(200),
  detail: z.string().max(5000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  priority: z.enum(JobPriority).optional(),
  send: z.boolean().optional(),
});

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const params = searchParams(req);
  const status = params.get('status') as JobStatus | null;
  const take = params.get('take');
  const skip = params.get('skip');
  return listJobs({
    status: status && status in JobStatus ? status : undefined,
    q: params.get('q')?.trim() || undefined,
    contactId: params.get('contactId') || undefined,
    channelId: channelScope(user, params.get('channelId')),
    take: take ? Number(take) : undefined,
    skip: skip ? Number(skip) : undefined,
  });
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const dto = await parseBody(req, CreateJobBody);
  await assertContactAccess(user, dto.contactId);
  return createJob(dto, user.id);
});
