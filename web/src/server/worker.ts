import { JOB_DISPATCH_QUEUE, markFailed, performDispatch } from './jobs';
import { LINE_EVENTS_QUEUE, LineEventTask, processLineEvent } from './line/events';
import { startMaintenance } from './maintenance';
import { deliverPush, LINE_PUSH_QUEUE } from './notifications';
import { register, startPolling } from './queue';

/** Register every queue handler (also used by tests, which drain the queue by hand). */
export function registerHandlers() {
  register(LINE_EVENTS_QUEUE, (task: LineEventTask) => processLineEvent(task));
  register(
    JOB_DISPATCH_QUEUE,
    ({ jobId }: { jobId: string }) => performDispatch(jobId),
    ({ jobId }: { jobId: string }, err) => markFailed(jobId, err.message),
  );
  register(LINE_PUSH_QUEUE, (payload) => deliverPush(payload));
}

export function startWorker() {
  registerHandlers();
  startPolling();
  startMaintenance();
}
