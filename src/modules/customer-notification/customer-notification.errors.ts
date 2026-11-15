import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error answers of the notification routes, in the customer API's shape
 * ({ statusCode, code, message, ...extra }; docs/customer-app-api.md 1.4).
 * SERVICE_LOCKED is in the contract's code list; MESSAGE_NOT_FOUND is added
 * there by this module.
 */
export function notificationError(status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}): HttpException {
  return new HttpException({ statusCode: status, code, message, ...extra }, status);
}

export function validationFailed(field: string, message: string): HttpException {
  return notificationError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', message, { field });
}
