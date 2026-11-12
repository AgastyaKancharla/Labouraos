import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getLoginCodeSecret } from './login-code.secret';

/** Inclusive start of the odd-hours window, 24-hour clock in Asia/Kolkata. */
export const ODD_HOUR_START_IST = 22;
/** Exclusive end of the odd-hours window, 24-hour clock in Asia/Kolkata. */
export const ODD_HOUR_END_IST = 6;

export const LOGIN_CODE_ROLES = ['team_lead', 'call_agent', 'field_agent'] as const;

export function loginCodeFor(requestId: string, secret = getLoginCodeSecret()): string {
  const digest = createHmac('sha256', secret).update(requestId).digest('hex');
  const decimal = BigInt(`0x${digest}`).toString(10);
  return decimal.slice(0, 6).padStart(6, '0');
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
