import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { env } from './env';

export interface ClaimedTask {
  id: string;
  queue: string;
  payload: any;
  attempts: number;
  maxAttempts: number;
}

export type TaskHandler = (payload: any, task: ClaimedTask) => Promise<void>;
export type FailedHandler = (payload: any, error: Error) => Promise<void>;

interface Registration {
  handler: TaskHandler;
  onFailed?: FailedHandler;
}

const STALE_LOCK_MS = 5 * 60 * 1000;

const registrations = new Map<string, Registration>();
let timer: NodeJS.Timeout | undefined;
let ticking = false;

/*
 * Small durable work queue on top of Postgres (`FOR UPDATE SKIP LOCKED`), so the
 * system needs no Redis. Failed tasks are retried with exponential backoff.
 * Route handlers only enqueue; tasks are processed by the worker in the custom server.
 */

export function register(queue: string, handler: TaskHandler, onFailed?: FailedHandler) {
  registrations.set(queue, { handler, onFailed });
}

export async function enqueue(queue: string, payload: unknown, opts: { delayMs?: number; maxAttempts?: number } = {}) {
  return prisma.queueTask.create({
    data: {
      queue,
      payload: payload as Prisma.InputJsonValue,
      maxAttempts: opts.maxAttempts ?? env.queueMaxAttempts,
      runAt: new Date(Date.now() + (opts.delayMs ?? 0)),
    },
  });
}

export function startPolling() {
  if (timer) return;
  timer = setInterval(() => void tick(), env.queuePollMs);
}

export function stopPolling() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

/** Process every task that is due right now. Used by the poller and by tests. */
export async function drain(maxTasks = 1000): Promise<number> {
  let processed = 0;
  while (processed < maxTasks && (await processNext())) processed++;
  return processed;
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await recoverStale();
    await drain(50);
  } catch (err) {
    console.error(`[queue] tick failed: ${(err as Error).message}`);
  } finally {
    ticking = false;
  }
}

async function recoverStale() {
  await prisma.queueTask.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: 'PENDING', lockedAt: null },
  });
}

async function processNext(): Promise<boolean> {
  const queues = [...registrations.keys()];
  if (!queues.length) return false;

  const rows = await prisma.$queryRaw<ClaimedTask[]>`
    UPDATE "QueueTask"
    SET status = 'RUNNING', "lockedAt" = now(), attempts = attempts + 1, "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "QueueTask"
      WHERE status = 'PENDING' AND "runAt" <= now() AND queue = ANY(${queues})
      ORDER BY "runAt", "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, queue, payload, attempts, "maxAttempts"`;
  const task = rows[0];
  if (!task) return false;

  const reg = registrations.get(task.queue)!;
  try {
    await reg.handler(task.payload, task);
    await prisma.queueTask.update({
      where: { id: task.id },
      data: { status: 'DONE', lockedAt: null, lastError: null },
    });
  } catch (err) {
    await fail(task, reg, err as Error);
  }
  return true;
}

async function fail(task: ClaimedTask, reg: Registration, error: Error) {
  const exhausted = task.attempts >= task.maxAttempts;
  const backoffMs = env.queueBackoffMs * 2 ** (task.attempts - 1);
  console.warn(`[queue] task ${task.queue}/${task.id} attempt ${task.attempts}/${task.maxAttempts} failed: ${error.message}`);
  await prisma.queueTask.update({
    where: { id: task.id },
    data: {
      status: exhausted ? 'FAILED' : 'PENDING',
      lockedAt: null,
      lastError: error.message.slice(0, 1000),
      runAt: exhausted ? undefined : new Date(Date.now() + backoffMs),
    },
  });
  if (exhausted && reg.onFailed) {
    try {
      await reg.onFailed(task.payload, error);
    } catch (hookErr) {
      console.error(`[queue] onFailed hook for ${task.queue} threw: ${(hookErr as Error).message}`);
    }
  }
}
