import { HttpException, HttpStatus } from '@nestjs/common';

const ERROR_NAMES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
};

/**
 * An error the apps can switch on: `{ statusCode, error, code, message, ...extra }`.
 * `code` is stable (UPPER_SNAKE); `message` is English for logs and fallback
 * (Laboura Field shows its own Kannada / English text for each code;
 * docs/api/field-redesign.md lists them).
 */
export function codedError(status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}): HttpException {
  return new HttpException(
    Object.assign({ statusCode: status, error: ERROR_NAMES[status] ?? 'Error', code, message }, extra),
    status,
  );
}
