import { randomInt } from 'node:crypto';

/**
 * Temporary passwords (Master Guide rev 174–175): issued when a staff account
 * is created, when a senior gives a new one, on "Reset sign-in completely"
 * and on reactivation. Shown once to the senior next to the staff code.
 *
 * 8 characters as two groups of 4 (K7M4-Q2PX), capital letters and digits
 * without the look-alikes 0, O, 1, I and L. Accepted in any case and with or
 * without the dash. Valid for 72 hours (decided 21 Nov: was 24; a senior can
 * still reissue one with one tap), works once (it ends when the person
 * finishes setting their own password). Stored only as a bcrypt hash.
 */
export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TEMP_PASSWORD_LENGTH = 8;
export const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

/** A new temporary password, crypto-random, as "XXXX-XXXX". */
export function generateTemporaryPassword(): string {
  let raw = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
    raw += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * The form that is hashed and compared: capitals, no dash or spaces. Anything
 * that cannot be a temporary password gives null (never compared).
 */
export function normaliseTemporaryPassword(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[\s-]/g, '').toUpperCase();
  if (cleaned.length !== TEMP_PASSWORD_LENGTH) return null;
  for (const ch of cleaned) {
    if (!TEMP_PASSWORD_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

/** Set-up ticket (first login, after the temporary password): 15 minutes, this device only. */
export const SETUP_TICKET_TTL_MS = 15 * 60 * 1000;
