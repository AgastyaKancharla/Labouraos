import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Machine-readable error codes for the customer API, so the app can show the
 * right screen without parsing English. Listed in docs/customer-app-api.md.
 * Every error body is { statusCode, code, message, ...extra }.
 */
export const CUSTOMER_ERROR_CODES = {
  TOKEN_MISSING: 'CUSTOMER_TOKEN_MISSING',
  TOKEN_INVALID: 'CUSTOMER_TOKEN_INVALID',
  TOKEN_EXPIRED: 'CUSTOMER_TOKEN_EXPIRED',
  SESSION_ENDED: 'CUSTOMER_SESSION_ENDED',
  ACCOUNT_BLOCKED: 'CUSTOMER_ACCOUNT_BLOCKED',
  ACCOUNT_DELETED: 'CUSTOMER_ACCOUNT_DELETED',
  REFRESH_INVALID: 'CUSTOMER_REFRESH_INVALID',
  PHONE_REQUIRED: 'PHONE_NOT_VERIFIED',
  PHONE_INVALID: 'PHONE_INVALID',
  PHONE_IN_USE: 'PHONE_IN_USE',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_LIMIT: 'OTP_LIMIT',
  GOOGLE_TOKEN_INVALID: 'GOOGLE_TOKEN_INVALID',
  GOOGLE_NOT_CONFIGURED: 'GOOGLE_NOT_CONFIGURED',
  STEP_UP_REQUIRED: 'STEP_UP_REQUIRED',
  PROFILE_NOT_FOUND: 'PROFILE_NOT_FOUND',
  PROFILE_KIND_MISMATCH: 'PROFILE_KIND_MISMATCH',
  PROFILE_EXISTS: 'PROFILE_EXISTS',
  ALREADY_REGISTERED_OTHER_KIND: 'ALREADY_REGISTERED_OTHER_KIND',
  UNDER_18: 'UNDER_18',
  VALIDATION: 'VALIDATION_FAILED',
  REFERRAL_SELF: 'REFERRAL_SELF',
  REFERRAL_PAUSED: 'REFERRAL_PAUSED',
  NOT_ALLOWED: 'NOT_ALLOWED',
  GUARANTEE_WARNING_REQUIRED: 'GUARANTEE_WARNING_REQUIRED',
  BELOW_MINIMUM_WAGE_TICK_REQUIRED: 'BELOW_MINIMUM_WAGE_TICK_REQUIRED',
  DELETION_PENDING: 'DELETION_PENDING',
  SERVICE_LOCKED: 'SERVICE_LOCKED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const;

export type CustomerErrorCode = (typeof CUSTOMER_ERROR_CODES)[keyof typeof CUSTOMER_ERROR_CODES];

export class CustomerApiError extends HttpException {
  constructor(status: HttpStatus, code: CustomerErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super({ statusCode: status, code, message, ...extra }, status);
  }
}

export function customerUnauthorized(code: CustomerErrorCode, message: string): CustomerApiError {
  return new CustomerApiError(HttpStatus.UNAUTHORIZED, code, message);
}
