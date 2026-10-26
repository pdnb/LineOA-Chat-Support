import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import { signBody, verifyBodySignature, verifyLineSignature } from './hmac';

describe('hmac', () => {
  const body = JSON.stringify({ hello: 'โลก' });

  it('signs and verifies integration bodies', () => {
    const sig = signBody(body, 's3cret');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyBodySignature(body, 's3cret', sig)).toBe(true);
    expect(verifyBodySignature(body, 'other', sig)).toBe(false);
    expect(verifyBodySignature(body + ' ', 's3cret', sig)).toBe(false);
    expect(verifyBodySignature(body, 's3cret', undefined)).toBe(false);
  });

  it('verifies LINE signatures (base64)', () => {
    const sig = createHmac('sha256', 'chan').update(body).digest('base64');
    expect(verifyLineSignature(body, 'chan', sig)).toBe(true);
    expect(verifyLineSignature(body, 'chan', 'bogus')).toBe(false);
  });
});
