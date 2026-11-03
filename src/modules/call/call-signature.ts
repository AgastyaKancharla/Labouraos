import { createHmac, timingSafeEqual } from 'crypto';

export function signCallStatusBody(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function callStatusSignatureMatches(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!rawBody || !signature || !secret) {
    return false;
  }
  const expected = signCallStatusBody(rawBody, secret);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length) {
    return false;
  }
  return timingSafeEqual(given, wanted);
}
