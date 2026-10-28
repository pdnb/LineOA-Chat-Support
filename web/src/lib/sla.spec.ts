import { describe, expect, it } from 'vitest';
import { slaClock } from './sla';

const cfg = { enabled: true, queueWaitMinutes: 10, firstResponseMinutes: 20 };
const now = Date.parse('2026-10-27T10:00:00Z');
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

describe('slaClock', () => {
  it('measures queue wait from waitingSince', () => {
    expect(slaClock({ status: 'QUEUED', waitingSince: ago(5) }, cfg, now)).toMatchObject({ kind: 'queue', level: 'ok' });
    expect(slaClock({ status: 'QUEUED', waitingSince: ago(8) }, cfg, now)?.level).toBe('warn');
    expect(slaClock({ status: 'QUEUED', waitingSince: ago(10) }, cfg, now)?.level).toBe('breach');
  });

  it('measures the first answer of an assigned chat from queuedAt', () => {
    expect(slaClock({ status: 'ASSIGNED', queuedAt: ago(25) }, cfg, now)).toMatchObject({ kind: 'response', level: 'breach' });
    expect(slaClock({ status: 'ASSIGNED', queuedAt: ago(25), firstResponseAt: ago(1) }, cfg, now)).toBeNull();
  });

  it('has no clock for bot or resolved chats, or when disabled', () => {
    expect(slaClock({ status: 'BOT', queuedAt: ago(99) }, cfg, now)).toBeNull();
    expect(slaClock({ status: 'RESOLVED', queuedAt: ago(99) }, cfg, now)).toBeNull();
    expect(slaClock({ status: 'QUEUED', waitingSince: ago(99) }, { ...cfg, enabled: false }, now)).toBeNull();
  });
});
