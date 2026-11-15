import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getLoginCodeSecret } from './login-code.secret';

/** Inclusive start of the odd-hours window, 24-hour clock in Asia/Kolkata. */
export const ODD_HOUR_START_IST = 22;
/** Exclusive end of the odd-hours window, 24-hour clock in Asia/Kolkata. */
export const ODD_HOUR_END_IST = 6;

/** Call agents and field agents (the shared list; Team Leads use their authenticator since rev 174–175). */
export { LOGIN_CODE_ROLES } from '../../common/auth/sign-in-roles';

/**
 * Six decimal digits from a hex HMAC digest, uniform over 000000–999999
 * (security AUTH-1). The digest is a 256-bit number; taking it modulo 10^6
 * leaves a bias below 10^-70. The old "first 6 decimal digits" never started
 * with 0 and started with 1 about 23% of the time (Benford).
 */
export function sixDigitCode(hexDigest: string): string {
  return (BigInt(`0x${hexDigest}`) % 1_000_000n).toString(10).padStart(6, '0');
}

export function loginCodeFor(requestId: string, secret = getLoginCodeSecret()): string {
  return sixDigitCode(createHmac('sha256', secret).update(requestId).digest('hex'));
}

/**
 * The proof handed only to the device and sign-in that asked for a login
 * code (in the `awaiting_code` answer). The code alone is not enough: it is
 * read out by a Team Lead and may be overheard, so POST /auth/login/verify-code
 * also needs this proof and the same device id. Bound to the request and its
 * device; never shown on the login code screens.
 */
export function loginRequestProofFor(requestId: string, deviceId: string, secret = getLoginCodeSecret()): string {
  return createHmac('sha256', secret).update(`login-request-proof:${requestId}:${deviceId}`).digest('base64url');
}

export function loginCodesMatch(supplied: string, expected: string): boolean {
  const left = createHash('sha256').update(supplied).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

export function isOddHourIst(at: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(at),
  );
  return hour >= ODD_HOUR_START_IST || hour < ODD_HOUR_END_IST;
}
