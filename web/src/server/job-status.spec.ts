import { describe, expect, it } from 'vitest';
import { canDispatch, canTransition, isTerminal } from './job-status';

describe('job status transitions', () => {
  it('follows the normal lifecycle', () => {
    expect(canTransition('DRAFT', 'SENT')).toBe(true);
    expect(canTransition('SENT', 'ACCEPTED')).toBe(true);
    expect(canTransition('ACCEPTED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'DONE')).toBe(true);
  });

  it('lets a downstream system skip ahead', () => {
    expect(canTransition('SENT', 'DONE')).toBe(true);
    expect(canTransition('SENT', 'REJECTED')).toBe(true);
  });

  it('never moves backwards or out of a terminal state', () => {
    expect(canTransition('IN_PROGRESS', 'ACCEPTED')).toBe(false);
    expect(canTransition('DONE', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('REJECTED', 'DONE')).toBe(false);
    expect(canTransition('DRAFT', 'DONE')).toBe(false);
    expect(isTerminal('DONE')).toBe(true);
    expect(isTerminal('SENT')).toBe(false);
  });

  it('allows resending only drafts and failures', () => {
    expect(canDispatch('DRAFT')).toBe(true);
    expect(canDispatch('FAILED')).toBe(true);
    expect(canDispatch('SENT')).toBe(false);
    expect(canTransition('FAILED', 'SENT')).toBe(true);
  });
});
