import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Security AC-5: a token for a link sent by SMS (a receipt, an invoice) that
 * carries its own expiry inside the signed value: `<expiry, base 36 seconds>.<HMAC>`.
 * Changing the expiry breaks the signature, and an expired token opens nothing.
 * Tokens of the old form (no expiry) are refused.
 */
export function signExpiringToken(key: Buffer, subjectId: string, validDays: number, now: Date = new Date()): string {
  const expiresAtSeconds = Math.floor(now.getTime() / 1000) + Math.round(validDays * 24 * 60 * 60);
  const expiry = expiresAtSeconds.toString(36);
  return `${expiry}.${signature(key, subjectId, expiry)}`;
}

export function verifyExpiringToken(key: Buffer, subjectId: string, token: unknown, now: Date = new Date()): boolean {
  if (typeof token !== 'string' || !subjectId) return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return false;
  const expiry = token.slice(0, dot);
  if (!/^[0-9a-z]{1,12}$/.test(expiry)) return false;
  const expected = Buffer.from(signature(key, subjectId, expiry));
  const supplied = Buffer.from(token.slice(dot + 1));
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
  return parseInt(expiry, 36) * 1000 > now.getTime();
}

function signature(key: Buffer, subjectId: string, expiry: string): string {
  return createHmac('sha256', key).update(`${subjectId}:${expiry}`).digest('base64url');
}
