import { PricingPolicy } from '@prisma/client';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';

/**
 * Own shifts (Master Guide rev 202, decided 21 Nov): each agent has their own
 * shift — a start time plus about 9 hours — set by their Team Lead, a Manager
 * over them or the CEO. Lateness, the late-login grace, a half day of leave's
 * working half, the shift shown on the agent's screens and the sign-in safety
 * cap all use the person's own shift. Someone with no shift of their own works
 * the company shift from Settings (PricingPolicy.shiftStart / shiftEnd,
 * 09:30–18:30 by default).
 *
 * Times are "HH:MM" on the IST clock. A shift starts and ends on the same IST
 * day (no overnight shifts: calls only run 09:00–21:00).
 */
export interface StaffShift {
  start: string;
  end: string;
  /** True when the person has a shift of their own; false for the company shift. */
  own: boolean;
}

export type ShiftPolicy = Pick<PricingPolicy, 'shiftStart' | 'shiftEnd'>;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Shortest and longest own shift a senior may set. */
export const MIN_SHIFT_MINUTES = 60;
export const MAX_SHIFT_MINUTES = 14 * 60;

export function isShiftTime(value: unknown): value is string {
  return typeof value === 'string' && HHMM.test(value);
}

export function minutesOfDay(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map((part) => Number(part));
  return hour * 60 + minute;
}

/** The person's own shift, or the company shift when they have none (or only half of one). */
export function shiftFor(
  staff: { shiftStart?: string | null; shiftEnd?: string | null } | null | undefined,
  policy: ShiftPolicy,
): StaffShift {
  if (staff && isShiftTime(staff.shiftStart) && isShiftTime(staff.shiftEnd)) {
    return { start: staff.shiftStart, end: staff.shiftEnd, own: true };
  }
  return { start: policy.shiftStart, end: policy.shiftEnd, own: false };
}

/** The policy fields lateness reads, with the person's own shift in place of the company one. */
export function withShift<P extends ShiftPolicy>(policy: P, shift: StaffShift): P {
  return { ...policy, shiftStart: shift.start, shiftEnd: shift.end };
}

/**
 * Why an own shift cannot be saved, or null when it can. Both times are
 * "HH:MM", the end after the start on the same day, 1 to 14 hours long.
 */
export function shiftProblem(start: unknown, end: unknown): string | null {
  if (!isShiftTime(start) || !isShiftTime(end)) return 'Shift times are written as HH:MM (24-hour clock, IST)';
  const length = minutesOfDay(end) - minutesOfDay(start);
  if (length <= 0) return 'The shift must end after it starts, on the same day';
  if (length < MIN_SHIFT_MINUTES || length > MAX_SHIFT_MINUTES) return 'A shift is between 1 and 14 hours long';
  return null;
}

/** The UTC instant of an IST clock time on the IST calendar day of `at`. */
export function istClockOn(at: Date, hhmm: string): Date {
  const parts = getCalendarPartsInTimezone(at);
  const minutes = minutesOfDay(hhmm);
  // IST is UTC+05:30 all year.
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, minutes) - 330 * 60 * 1000);
}

/** When the person's shift ends today (IST), as a UTC instant. */
export function shiftEndOn(at: Date, shift: StaffShift): Date {
  return istClockOn(at, shift.end);
}

/** When the person's shift starts today (IST), as a UTC instant. */
export function shiftStartOn(at: Date, shift: StaffShift): Date {
  return istClockOn(at, shift.start);
}

/** True while `at` is inside the person's shift today. */
export function onShiftAt(at: Date, shift: StaffShift): boolean {
  const t = at.getTime();
  return t >= shiftStartOn(at, shift).getTime() && t < shiftEndOn(at, shift).getTime();
}
