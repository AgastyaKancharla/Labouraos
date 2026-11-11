import { Injectable } from '@nestjs/common';

/** "Now" for the call agent console's reads, so tests can fix the time. */
@Injectable()
export class CallWorkClock {
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

/** Minutes past IST midnight. */
export function istMinuteOfDay(at: Date): number {
  return Math.floor(((at.getTime() + IST_OFFSET_MS) % DAY_MS) / 60000);
}
