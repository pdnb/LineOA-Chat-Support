import { env } from './env';
import { cleanupDone } from './queue';
import { checkSla } from './sla';

/* Periodic jobs that run next to the queue worker: SLA alerts and pruning finished queue tasks. */

const CLEANUP_EVERY_MS = 60 * 60 * 1000;
let timers: NodeJS.Timeout[] = [];

async function safely(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[maintenance] ${name} failed: ${(err as Error).message}`);
  }
}

export function startMaintenance() {
  if (timers.length) return;
  const cleanup = () =>
    safely('queue cleanup', () => cleanupDone(new Date(Date.now() - env.queueDoneRetentionDays * 86400_000)));
  timers = [
    setInterval(() => void safely('SLA check', () => checkSla()), env.slaCheckMs),
    setInterval(() => void cleanup(), CLEANUP_EVERY_MS),
  ];
  void cleanup();
}

export function stopMaintenance() {
  for (const t of timers) clearInterval(t);
  timers = [];
}
