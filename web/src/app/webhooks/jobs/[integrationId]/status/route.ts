import { JobStatus } from '@prisma/client';
import { z } from 'zod';
import { route } from '@/server/http';
import { applyCallback } from '@/server/jobs';

const CallbackBody = z.object({
  jobId: z.string().optional(),
  number: z.string().optional(),
  status: z.enum(JobStatus),
  externalRef: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/** Public endpoint for downstream systems; authenticated by the integration's HMAC secret. */
export const POST = route<{ integrationId: string }>(async (req, { integrationId }) => {
  // The signature covers the exact bytes, so read the raw body before parsing.
  const raw = await req.text();
  const dto = CallbackBody.parse(raw ? JSON.parse(raw) : {});
  const job = await applyCallback(integrationId, raw, req.headers.get('x-signature') ?? undefined, dto);
  return Response.json({ ok: true, jobId: job.id, number: job.number, status: job.status });
});
