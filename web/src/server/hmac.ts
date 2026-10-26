import { createHmac, timingSafeEqual } from 'crypto';

/** Hex HMAC-SHA256 of the raw body, formatted as `sha256=<hex>`. */
export function signBody(body: string | Buffer, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

export function verifyBodySignature(body: string | Buffer, secret: string, signature?: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signBody(body, secret));
  const given = Buffer.from(signature.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** LINE's x-line-signature: base64 HMAC-SHA256 of the raw body with the channel secret. */
export function verifyLineSignature(body: string | Buffer, channelSecret: string, signature?: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac('sha256', channelSecret).update(body).digest('base64'));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
