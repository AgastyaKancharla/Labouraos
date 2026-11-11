import { BadRequestException } from '@nestjs/common';

/**
 * The time an approval or money decision is made at. Always the server's clock in
 * production: a date sent by the caller (`asOf`, `now`) is ignored, so nobody can
 * release a refund early by sending a future date or skip a wait by back-dating.
 * Only when NODE_ENV is 'test' (Jest and CI) does a caller date stand in for the
 * clock, so tests can check day 14, 15, 16 and so on.
 */
export function decisionTime(callerValue?: string | Date | null, serverNow: Date = new Date()): Date {
  if (callerValue === undefined || callerValue === null || callerValue === '') {
    return serverNow;
  }
  if (process.env.NODE_ENV !== 'test') {
    return serverNow;
  }
  const parsed = callerValue instanceof Date ? callerValue : new Date(callerValue);
  if (isNaN(parsed.getTime())) {
    throw new BadRequestException('asOf must be a valid date string');
  }
  return parsed;
}
