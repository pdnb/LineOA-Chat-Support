import { Category, Contact, Integration, Job, JobEventSource, JobPriority, JobStatus, LineChannel, Prisma } from '@prisma/client';
import { prisma } from './db';
import { env } from './env';
import { signBody, verifyBodySignature } from './hmac';
import { badRequest, conflict, notFound, unauthorized } from './http';
import { CALLBACK_STATUSES, canDispatch, canTransition } from './job-status';
import { notifyJobStatus } from './notifications';
import { enqueue } from './queue';
import { emit as emitRealtime } from './realtime';

export const JOB_DISPATCH_QUEUE = 'job-dispatch';

export const JOB_INCLUDE = {
  contact: { include: { channel: { select: { id: true, name: true, basicId: true } } } },
  category: { select: { id: true, code: true, name: true } },
  integration: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.JobInclude;

export interface CreateJobInput {
  contactId: string;
  conversationId?: string | null;
  categoryId?: string | null;
  integrationId?: string | null;
  title: string;
  detail?: string | null;
  payload?: Record<string, unknown>;
  priority?: JobPriority;
  send?: boolean;
}

export interface CallbackBody {
  jobId?: string;
  number?: string;
  status: JobStatus;
  externalRef?: string;
  note?: string;
  data?: Record<string, unknown>;
}

/** JSON body POSTed to the downstream system. Documented in docs/integration-api.md. */
export function buildDispatchBody(
  job: Job & {
    contact: Contact & { channel: Pick<LineChannel, 'id' | 'name' | 'basicId'> };
    category: Pick<Category, 'code' | 'name'> | null;
  },
  callbackUrl: string,
) {
  return {
    event: 'job.created',
    job: {
      id: job.id,
      number: job.number,
      title: job.title,
      detail: job.detail,
      priority: job.priority,
      category: job.category ? { code: job.category.code, name: job.category.name } : null,
      data: job.payload,
      createdAt: job.createdAt.toISOString(),
    },
    customer: {
      id: job.contact.id,
      lineUserId: job.contact.lineUserId,
      displayName: job.contact.displayName,
      phone: job.contact.phone,
    },
    /** The LINE OA the customer contacted */
    channel: { id: job.contact.channel.id, name: job.contact.channel.name, basicId: job.contact.channel.basicId },
    callbackUrl,
  };
}

function bangkokPeriod(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}${parts.month}`;
}

export async function createJob(input: CreateJobInput, actorId?: string) {
  const category = input.categoryId ? await prisma.category.findUnique({ where: { id: input.categoryId } }) : null;
  if (input.categoryId && !category) throw badRequest('Unknown category');
  const integrationId = input.integrationId ?? category?.integrationId ?? null;

  const number = await nextNumber();
  const job = await prisma.job.create({
    data: {
      number,
      contactId: input.contactId,
      conversationId: input.conversationId ?? null,
      categoryId: category?.id ?? null,
      integrationId,
      title: input.title,
      detail: input.detail ?? null,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      priority: input.priority ?? 'NORMAL',
      createdById: actorId ?? null,
      events: {
        create: {
          status: 'DRAFT',
          source: actorId ? 'AGENT' : 'SYSTEM',
          note: actorId ? 'เจ้าหน้าที่สร้างงาน' : 'Bot สร้างงานจากข้อมูลลูกค้า',
        },
      },
    },
  });
  if (job.conversationId) {
    await prisma.message.create({
      data: {
        conversationId: job.conversationId,
        direction: 'OUT',
        senderType: 'SYSTEM',
        type: 'system',
        text: `สร้างงาน ${job.number}: ${job.title}`,
        payload: { jobId: job.id },
      },
    });
  }
  if (input.send !== false && integrationId) await dispatchJob(job.id, actorId);
  else emitJob(job.id);
  return getJob(job.id);
}

/** Queue the job for delivery to its integration (initial send or resend after failure). */
export async function dispatchJob(jobId: string, actorId?: string) {
  const job = await mustGet(jobId);
  if (!job.integrationId) throw badRequest('Job has no target integration');
  if (!canDispatch(job.status)) throw conflict(`Job is already ${job.status}`);
  if (job.status === 'FAILED') {
    await prisma.jobEvent.create({
      data: { jobId, source: actorId ? 'AGENT' : 'SYSTEM', note: 'สั่งส่งงานใหม่อีกครั้ง' },
    });
  }
  await prisma.job.update({ where: { id: jobId }, data: { lastError: null } });
  await enqueue(JOB_DISPATCH_QUEUE, { jobId });
  emitJob(jobId);
}

/** Queue handler: POST the job to its integration. Throws so the queue retries. */
export async function performDispatch(jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { contact: { include: { channel: true } }, category: true, integration: true },
  });
  if (!canDispatch(job.status)) return; // already delivered (e.g. duplicate task)
  const integration = job.integration;
  if (!integration || !integration.isActive) throw new Error('Integration missing or inactive');

  const body = JSON.stringify(buildDispatchBody(job, callbackUrl(integration.id)));
  const res = await post(integration, body, job.id);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);

  let reply: { externalRef?: string; status?: JobStatus } = {};
  try {
    reply = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON 2xx responses are accepted as plain acknowledgements.
  }
  await changeStatus(job.id, 'SENT', {
    source: 'SYSTEM',
    note: `ส่งไปยัง ${integration.name} สำเร็จ (HTTP ${res.status})`,
    externalRef: reply.externalRef,
  });
  if (reply.status && reply.status !== 'SENT' && CALLBACK_STATUSES.includes(reply.status)) {
    await changeStatus(job.id, reply.status, { source: 'INTEGRATION', note: 'ตอบกลับทันทีจากระบบปลายทาง' });
  }
}

/** Queue failure hook: the dispatch ran out of attempts. */
export async function markFailed(jobId: string, error: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || !canDispatch(job.status)) return;
  await changeStatus(jobId, 'FAILED', { source: 'SYSTEM', note: 'ส่งงานไม่สำเร็จ', lastError: error });
}

/** Status update from a downstream system. `rawBody` must be the exact bytes that were signed. */
export async function applyCallback(integrationId: string, rawBody: string, signature: string | undefined, body: CallbackBody) {
  const integration = await prisma.integration.findUnique({ where: { id: integrationId } });
  if (!integration) throw notFound('Unknown integration');
  if (!verifyBodySignature(rawBody, integration.secret, signature)) throw unauthorized('Invalid signature');
  if (!CALLBACK_STATUSES.includes(body.status)) {
    throw badRequest(`status must be one of ${CALLBACK_STATUSES.join(', ')}`);
  }
  const job = await prisma.job.findFirst({
    where: {
      integrationId,
      OR: [...(body.jobId ? [{ id: body.jobId }] : []), ...(body.number ? [{ number: body.number }] : [])],
    },
  });
  if (!job) throw notFound('Job not found for this integration');

  if (job.status === body.status) {
    // Repeated status: keep it as a note, no customer notification.
    await prisma.jobEvent.create({
      data: { jobId: job.id, source: 'INTEGRATION', note: body.note, data: body.data as Prisma.InputJsonValue },
    });
    emitJob(job.id);
    return getJob(job.id);
  }
  if (!canTransition(job.status, body.status)) {
    throw conflict(`Cannot move job from ${job.status} to ${body.status}`);
  }
  await changeStatus(job.id, body.status, {
    source: 'INTEGRATION',
    note: body.note,
    data: body.data,
    externalRef: body.externalRef,
  });
  return getJob(job.id);
}

export async function changeStatus(
  jobId: string,
  to: JobStatus,
  opts: {
    source: JobEventSource;
    note?: string | null;
    data?: Record<string, unknown>;
    externalRef?: string;
    lastError?: string;
  },
) {
  const job = await mustGet(jobId);
  if (!canTransition(job.status, to)) throw conflict(`Cannot move job from ${job.status} to ${to}`);
  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: to,
      externalRef: opts.externalRef ?? undefined,
      lastError: to === 'FAILED' ? (opts.lastError ?? null) : null,
      events: {
        create: {
          status: to,
          source: opts.source,
          note: opts.note ?? opts.lastError ?? null,
          data: opts.data as Prisma.InputJsonValue,
        },
      },
    },
  });
  emitJob(jobId);
  await notifyJobStatus(updated, to, opts.note);
  return updated;
}

export async function listJobs(filter: {
  status?: JobStatus;
  q?: string;
  contactId?: string;
  channelId?: Prisma.StringFilter;
  take?: number;
  skip?: number;
}) {
  const where: Prisma.JobWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.channelId) where.contact = { channelId: filter.channelId };
  if (filter.contactId) where.contactId = filter.contactId;
  if (filter.q) {
    where.OR = [
      { number: { contains: filter.q, mode: 'insensitive' } },
      { title: { contains: filter.q, mode: 'insensitive' } },
      { externalRef: { contains: filter.q, mode: 'insensitive' } },
      { contact: { displayName: { contains: filter.q, mode: 'insensitive' } } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.job.findMany({
      where,
      include: JOB_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.take ?? 50, 200),
      skip: filter.skip ?? 0,
    }),
    prisma.job.count({ where }),
  ]);
  return { items, total };
}

export async function recentForContact(contactId: string, take = 5) {
  return prisma.job.findMany({ where: { contactId }, orderBy: { createdAt: 'desc' }, take });
}

export async function getJob(id: string) {
  const job = await prisma.job.findUnique({
    where: { id },
    include: { ...JOB_INCLUDE, events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!job) throw notFound('Job not found');
  return job;
}

/** Send a signed `ping` to check an integration's endpoint and secret. */
export async function pingIntegration(integration: Integration) {
  const started = Date.now();
  const body = JSON.stringify({ event: 'ping', sentAt: new Date().toISOString() });
  try {
    const res = await post(integration, body, `ping-${started}`);
    return { ok: res.ok, status: res.status, ms: Date.now() - started, body: (await res.text()).slice(0, 500) };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, body: (err as Error).message };
  }
}

export function callbackUrl(integrationId: string) {
  return `${env.publicBaseUrl}/webhooks/jobs/${integrationId}/status`;
}

function post(integration: Integration, body: string, idempotencyKey: string) {
  const headers: Record<string, string> = {
    ...((integration.headers as Record<string, string> | null) ?? {}),
    'Content-Type': 'application/json',
    'X-Signature': signBody(body, integration.secret),
    'Idempotency-Key': idempotencyKey,
    'User-Agent': 'cc-lineoa-support/1.0',
  };
  return fetch(integration.endpointUrl, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(integration.timeoutMs),
  });
}

async function nextNumber() {
  const period = bangkokPeriod();
  const rows = await prisma.$queryRaw<{ seq: number }[]>`
    INSERT INTO "JobCounter" (period, seq) VALUES (${period}, 1)
    ON CONFLICT (period) DO UPDATE SET seq = "JobCounter".seq + 1
    RETURNING seq`;
  return `JOB-${period}-${String(rows[0].seq).padStart(4, '0')}`;
}

async function mustGet(id: string) {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) throw notFound('Job not found');
  return job;
}

function emitJob(jobId: string) {
  void prisma.job
    .findUnique({ where: { id: jobId }, include: JOB_INCLUDE })
    .then((job) => job && emitRealtime('job.updated', job, job.contact.channelId))
    .catch((err) => console.warn(`[jobs] emit job failed: ${err.message}`));
}
