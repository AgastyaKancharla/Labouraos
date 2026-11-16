import { createHmac } from 'node:crypto';
import { getJwtSecret } from '../auth/jwt-secret';

/**
 * INF-13: OtpSession.phoneHash is a keyed hash (HMAC-SHA256 with a key derived
 * from the server's JWT_SECRET, like the customer OTP limiter), so a leaked
 * table cannot be reversed by hashing every 10-digit mobile number. Rows
 * written before this used plain SHA-256; the migration
 * 20261201000100_otp_session_phone_hmac cleared them (test data only, and an
 * OTP session lives 5 minutes).
 */
let key: Buffer | null = null;

export function otpSessionPhoneHash(nationalDigits: string): string {
  if (!key) key = createHmac('sha256', getJwtSecret()).update('laboura:otp-session-phone:v1').digest();
  return createHmac('sha256', key).update(nationalDigits).digest('hex');
}
