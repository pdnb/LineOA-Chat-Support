import { describe, expect, it } from 'vitest';
import { redact } from './audit';

describe('audit redact', () => {
  it('hides credential-looking keys at any depth and keeps the rest', () => {
    const out = redact({
      name: 'OA',
      channelSecret: 'abc',
      accessToken: '',
      nested: { password: 'p', headers: { Authorization: 'Bearer x', 'X-Trace': '1' } },
      list: [{ secret: 's', ok: true }],
    });
    expect(out).toEqual({
      name: 'OA',
      channelSecret: '[redacted]',
      accessToken: '',
      nested: { password: '[redacted]', headers: { Authorization: '[redacted]', 'X-Trace': '1' } },
      list: [{ secret: '[redacted]', ok: true }],
    });
  });
});
