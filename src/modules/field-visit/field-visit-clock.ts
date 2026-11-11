import { Injectable } from '@nestjs/common';

/** "Now" for shop visits and the field app's reads, so tests can fix the time. */
@Injectable()
export class FieldVisitClock {
  now(): Date {
    return new Date();
  }
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the IST calendar day containing `at`, as a UTC instant. */
export function istDayStart(at: Date): Date {
  return new Date(Math.floor((at.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

/** The IST calendar date of `at` as "YYYY-MM-DD". */
export function istDateKey(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** A Prisma @db.Date value for an IST date key. */
export function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** "YYYY-MM-DD" of a @db.Date value. */
export function keyFromDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
