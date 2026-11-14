import type { MessageKey } from '@/i18n';
import { isApiError } from './errors';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Contract error codes (docs/customer-app-api.md 1.4) → the app's own words. */
const CODE_KEYS: Record<string, MessageKey> = {
  PHONE_INVALID: 'otp.invalidMobile',
  PHONE_IN_USE: 'error.phoneInUse',
  PHONE_NOT_VERIFIED: 'error.phoneNotVerified',
  OTP_INVALID: 'error.otpInvalid',
  OTP_EXPIRED: 'error.otpExpired',
  OTP_LIMIT: 'error.otpLimit',
  GOOGLE_TOKEN_INVALID: 'signIn.failed',
  GOOGLE_NOT_CONFIGURED: 'signIn.google.not_configured',
  UNDER_18: 'jobSeeker.under18',
  PROFILE_EXISTS: 'error.profileExists',
  NOT_ALLOWED: 'error.notAllowed',
  REFERRAL_SELF: 'error.referralSelf',
  REFERRAL_PAUSED: 'error.referralPaused',
  DELETION_PENDING: 'error.deletionPending',
  CUSTOMER_ACCOUNT_BLOCKED: 'error.blocked',
  NOT_IMPLEMENTED: 'error.notYet',
  STEP_UP_REQUIRED: 'error.stepUp',
};

/**
 * What to show for a failed call, in the person's language. The server's
 * `message` is English for testers; the one exception is VALIDATION_FAILED
 * from the existing forms, whose message names the field (shown as is).
 */
export function errorText(t: T, err: unknown): string {
  if (!isApiError(err)) return t('common.error');
  if (err.isNetworkError) return t('common.networkError');
  const code = err.code;
  if (code === 'OTP_INVALID') {
    const left = err.field<number>('attemptsLeft');
    if (typeof left === 'number') return t('error.otpInvalidLeft', { left });
  }
  if (code === 'OTP_LIMIT') {
    const seconds = err.field<number>('retryAfterSeconds');
    if (typeof seconds === 'number') return t('error.otpLimitWait', { minutes: Math.max(1, Math.ceil(seconds / 60)) });
  }
  if (code && CODE_KEYS[code]) return t(CODE_KEYS[code]);
  if (code === 'VALIDATION_FAILED' && err.message) return err.message;
  if (err.status === 404 || err.status === 501) return t('error.notYet');
  return t('common.error');
}
