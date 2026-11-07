import { createHmac, timingSafeEqual } from 'crypto';

export interface WebhookValidationResult {
  isValid: boolean;
  reason?:
    | 'secret_missing'
    | 'secret_too_short'
    | 'raw_body_missing'
    | 'signature_missing'
    | 'signature_mismatch';
}

/**
 * Validates that an incoming webhook carries a valid HMAC-SHA256 signature
 * checked against a configured secret of at least 32 characters.
 * Fails closed if the secret is missing or too short, or if the signature is missing or invalid.
 */
export function validateWebhookHmac(
  rawBody: Buffer | string | undefined | null,
  signature: string | undefined | null,
  secret: string | undefined | null,
  algorithm = 'sha256',
): WebhookValidationResult {
  if (!secret || typeof secret !== 'string') {
    return { isValid: false, reason: 'secret_missing' };
  }
  if (secret.length < 32) {
    return { isValid: false, reason: 'secret_too_short' };
  }
  if (rawBody === undefined || rawBody === null) {
    return { isValid: false, reason: 'raw_body_missing' };
  }
  if (!signature || typeof signature !== 'string' || !signature.trim()) {
    return { isValid: false, reason: 'signature_missing' };
  }

  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const expected = createHmac(algorithm, secret).update(raw).digest('hex');
  const sigClean = signature.trim().toLowerCase().replace(/^sha256=/, '');
  const expBuf = Buffer.from(expected.toLowerCase(), 'utf8');
  const sigBuf = Buffer.from(sigClean, 'utf8');

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { isValid: false, reason: 'signature_mismatch' };
  }

  return { isValid: true };
}

export function signWebhookHmac(
  rawBody: Buffer | string,
  secret: string,
  algorithm = 'sha256',
): string {
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return createHmac(algorithm, secret).update(raw).digest('hex');
}
