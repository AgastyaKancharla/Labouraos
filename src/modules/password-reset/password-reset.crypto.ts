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
