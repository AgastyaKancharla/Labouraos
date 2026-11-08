import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

/**
 * Reads PAYOUT_ACCOUNT_KEY. Throws if it is missing or shorter than 32 characters,
 * so the server refuses to start without a valid encryption key.
 */
export function getPayoutAccountKey(): Buffer {
  const secret = process.env.PAYOUT_ACCOUNT_KEY?.trim();
  if (!secret) {
    throw new Error(
      'PAYOUT_ACCOUNT_KEY environment variable is missing or empty. Server cannot start without a secure secret.',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `PAYOUT_ACCOUNT_KEY must be at least 32 characters long (received ${secret.length} characters).`,
    );
  }
  return createHash('sha256').update(secret).digest();
}

/**
 * Normalizes a payout identifier for consistent hashing and lookups:
 * - UPI: trimmed and lowercase.
 * - Bank: digits only.
 */
export function normalizePayoutValue(method: 'upi' | 'bank', val: string): string {
  const trimmed = val.trim();
  if (method === 'upi') {
    return trimmed.toLowerCase();
  }
  return trimmed.replace(/\D/g, '');
}

/**
 * Keyed HMAC-SHA256 hash of normalized payout value (UPI ID or account number).
 * Allows duplicate detection across owners without decrypting the underlying values.
 */
export function hashPayoutValue(method: 'upi' | 'bank', val: string): string {
  const normalized = normalizePayoutValue(method, val);
  const key = getPayoutAccountKey();
  return createHmac('sha256', key).update(normalized).digest('hex');
}

/**
 * Encrypts a sensitive payout value (UPI ID or account number) using AES-256-GCM.
 */
export function encryptPayoutValue(val: string): string {
  const key = getPayoutAccountKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(val.trim(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

/**
 * Decrypts a sensitive payout value (UPI ID or account number) using AES-256-GCM.
 */
export function decryptPayoutValue(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 3) {
    throw new Error('Stored payout value is not in valid encrypted format');
  }
  const [ivPart, tagPart, dataPart] = parts;
  const key = getPayoutAccountKey();
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Masks a payout value for safe display:
 * - UPI: e.g. "user123@okhdfcbank" -> "u***@okhdfcbank"
 * - Bank: e.g. "123456789012" -> "••••••••9012"
 */
export function maskPayoutValue(method: 'upi' | 'bank', val: string): string {
  const trimmed = val.trim();
  if (method === 'upi') {
    const atIdx = trimmed.indexOf('@');
    if (atIdx <= 0) {
      return '***@upi';
    }
    const handle = trimmed.slice(0, atIdx);
    const domain = trimmed.slice(atIdx);
    if (handle.length <= 2) {
      return `*${domain}`;
    }
    return `${handle[0]}***${domain}`;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length <= 4) {
    return `••••${digits}`;
  }
  const last4 = digits.slice(-4);
  return `••••••••${last4}`;
}
