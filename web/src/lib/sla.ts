/*
 * SLA clocks, shared by the console (timers) and the server (alerts).
 * - queue:    a QUEUED chat waiting for someone to take it, since `waitingSince`
 * - response: an ASSIGNED chat no agent has answered yet, since `queuedAt`
 */

export interface SlaConfig {
  enabled: boolean;
  queueWaitMinutes: number;
  firstResponseMinutes: number;
}

export type SlaLevel = 'ok' | 'warn' | 'breach';

export interface SlaClock {
  kind: 'queue' | 'response';
  elapsedMs: number;
  limitMs: number;
  level: SlaLevel;
}

interface SlaFields {
  status: string;
  waitingSince?: string | Date | null;
  queuedAt?: string | Date | null;
  firstResponseAt?: string | Date | null;
}

/** Warn once this share of the limit has passed. */
export const SLA_WARN_RATIO = 0.8;

export function slaClock(conv: SlaFields, cfg: SlaConfig | undefined, now: number = Date.now()): SlaClock | null {
  if (!cfg?.enabled) return null;
  let kind: SlaClock['kind'];
  let since: string | Date | null | undefined;
  let limitMin: number;
  if (conv.status === 'QUEUED') {
    kind = 'queue';
    since = conv.waitingSince ?? conv.queuedAt;
    limitMin = cfg.queueWaitMinutes;
  } else if (conv.status === 'ASSIGNED' && !conv.firstResponseAt) {
    kind = 'response';
    since = conv.queuedAt;
    limitMin = cfg.firstResponseMinutes;
  } else {
    return null;
  }
  if (!since) return null;
  const elapsedMs = Math.max(0, now - new Date(since).getTime());
  const limitMs = limitMin * 60_000;
  const level: SlaLevel = elapsedMs >= limitMs ? 'breach' : elapsedMs >= limitMs * SLA_WARN_RATIO ? 'warn' : 'ok';
  return { kind, elapsedMs, limitMs, level };
}
