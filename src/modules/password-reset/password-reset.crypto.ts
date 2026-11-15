import { createHmac } from 'node:crypto';
import { getLoginCodeSecret } from '../login-code/login-code.secret';

/**
 * Reset codes (Forgot password, rev 174–175) are worked out from the request
 * id like login codes, but under their own HMAC label, so a reset code can
 * never be a login code (and a login code never a reset code). Never stored.
 */
export function resetCodeFor(requestId: string, secret = getLoginCodeSecret()): string {
  const digest = createHmac('sha256', secret).update(`password-reset-code:${requestId}`).digest('hex');
  return BigInt(`0x${digest}`).toString(10).slice(0, 6).padStart(6, '0');
}

/**
 * The proof handed only to the device and sign-in page that asked (the code
 * is read out over the phone and may be overheard). Own label again.
 */
export function resetRequestProofFor(requestId: string, deviceId: string, secret = getLoginCodeSecret()): string {
  return createHmac('sha256', secret).update(`password-reset-proof:${requestId}:${deviceId}`).digest('base64url');
}

/**
 * The request id answered for a staff code that gets no request (unknown,
 * inactive, limited, or another request open). Worked out from the staff code,
 * the device and the 15-minute window, so asking again gives the same id, as
 * a real open request does; it looks like any other request id.
 */
export function standInResetRequestId(staffCode: string, deviceId: string, windowStart: number, secret = getLoginCodeSecret()): string {
  const hex = createHmac('sha256', secret)
    .update(`password-reset-stand-in:${staffCode.trim().toUpperCase()}:${deviceId}:${windowStart}`)
    .digest('hex');
  // UUID v4 layout, like the ids of real requests.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
