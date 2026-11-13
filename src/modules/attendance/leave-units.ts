/**
 * Half-day leave (owner decision 12 Nov): "Staff request leave with a calendar
 * and a reason, for full days or a half day (first half or second half); a half
 * day of leave uses half a day of the balance, and the other half is a normal
 * working half day."
 *
 * Leave is counted in whole half days (integers), so a balance of 1½ days is 3
 * halves and nothing is ever a float until it is shown.
 */

export const LEAVE_HALVES = ['first', 'second'] as const;
export type LeaveHalf = (typeof LEAVE_HALVES)[number];

export function isLeaveHalf(value: unknown): value is LeaveHalf {
  return typeof value === 'string' && (LEAVE_HALVES as readonly string[]).includes(value);
}

/** The leave fields of an attendance day. */
export interface LeaveDayFields {
  dayType: string;
  leaveKind: string | null;
  leaveUnpaid: boolean;
  leaveHalf?: string | null;
  leavePartUnpaid?: boolean;
}

/** Leave on one day, in half days: total = paid + unpaid. */
export interface LeaveHalves {
  total: number;
  paid: number;
  unpaid: number;
}

const NONE: LeaveHalves = { total: 0, paid: 0, unpaid: 0 };

/**
 * The leave a day carries, in half days.
 * - A half day of leave (leaveHalf set) is one half, whatever the working half
 *   did (the day may be open, full or half from the time worked).
 * - A full leave day (dayType 'leave') is two halves: both paid, both unpaid,
 *   or one of each when the paid balance ran out half way (leavePartUnpaid).
 * - A full leave day the person logged in on became a working day: no leave.
 */
export function leaveHalvesOf(row: LeaveDayFields): LeaveHalves {
  if (row.leaveHalf) {
    if (!row.leaveKind) return NONE;
    return row.leaveUnpaid ? { total: 1, paid: 0, unpaid: 1 } : { total: 1, paid: 1, unpaid: 0 };
  }
  if (row.dayType !== 'leave') return NONE;
  if (row.leaveUnpaid) return { total: 2, paid: 0, unpaid: 2 };
  if (row.leavePartUnpaid) return { total: 2, paid: 1, unpaid: 1 };
  return { total: 2, paid: 2, unpaid: 0 };
}

/** Half days → days for display (3 → 1.5). */
export function halvesToDays(halves: number): number {
  return halves / 2;
}

/** Days (whole or half) → half days (1.5 → 3). */
export function daysToHalves(days: number): number {
  return Math.round(days * 2);
}

/**
 * Splits leave days in date order between the paid balance and unpaid leave,
 * in half days: each day takes what is left of the balance first. A full day
 * with half a day of balance left is half paid, half unpaid.
 */
export function splitPaid(
  paidLeftHalves: number,
  dayHalves: number[],
): { perDay: Array<{ paid: number; unpaid: number }>; paidHalves: number; unpaidHalves: number } {
  let left = Math.max(0, Math.floor(paidLeftHalves));
  let paidHalves = 0;
  let unpaidHalves = 0;
  const perDay = dayHalves.map((halves) => {
    const paid = Math.min(left, halves);
    left -= paid;
    paidHalves += paid;
    unpaidHalves += halves - paid;
    return { paid, unpaid: halves - paid };
  });
  return { perDay, paidHalves, unpaidHalves };
}

/** The attendance fields that record a day's leave, for `halves` of it with `paid` of those paid. */
export function leaveFieldsFor(halves: 1 | 2, paid: number, half: LeaveHalf | null): {
  leaveUnpaid: boolean;
  leavePartUnpaid: boolean;
  leaveHalf: LeaveHalf | null;
} {
  if (halves === 1) return { leaveUnpaid: paid < 1, leavePartUnpaid: false, leaveHalf: half };
  return { leaveUnpaid: paid === 0, leavePartUnpaid: paid === 1, leaveHalf: null };
}

/** "1", "½", "1½" for a number of days in plain words on screens and bells. */
export function daysLabel(days: number): string {
  const whole = Math.floor(days);
  const half = days - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

/** What one closed day counts as on the month sheet, in half days (integers). */
export interface DayTally {
  fullHalves: number;
  /** Half days (dayType 'half'), as days: each costs half a day of pay. */
  halfDays: number;
  absentHalves: number;
  paidLeaveHalves: number;
  unpaidLeaveHalves: number;
  /** Paid leave halves that were emergency leave (the rest is casual). */
  emergencyPaidHalves: number;
}

/**
 * The month sheet's view of one day (attendance summary and payroll). A full
 * day is two halves; a half day of leave (owner decision 12 Nov) is one half
 * of leave plus a working half:
 * - working half worked (dayType 'full', half the production needed): one full half;
 * - working half not worked (dayType 'half': under the halved half line), or
 *   no login at all (the day stayed 'leave'): one absent half — loss of pay
 *   for half a day, as for any half day;
 * - the leave half is paid or unpaid leave (unpaid: half a day's loss of pay).
 * A full leave day is two halves of leave, paid and/or unpaid. Open days and
 * days off count nothing here.
 *
 * `past` is false for today and later (IST): a half day of leave not yet
 * reached has no absent working half (the person may still come in).
 */
export function dayTally(row: LeaveDayFields, past = true): DayTally {
  const tally: DayTally = { fullHalves: 0, halfDays: 0, absentHalves: 0, paidLeaveHalves: 0, unpaidLeaveHalves: 0, emergencyPaidHalves: 0 };
  const leave = leaveHalvesOf(row);
  tally.paidLeaveHalves = leave.paid;
  tally.unpaidLeaveHalves = leave.unpaid;
  if (row.leaveKind === 'emergency') tally.emergencyPaidHalves = leave.paid;
  if (row.leaveHalf && leave.total > 0) {
    if (row.dayType === 'full') tally.fullHalves = 1;
    else if (row.dayType === 'half') tally.absentHalves = 1;
    else if ((row.dayType === 'leave' || row.dayType === 'absent') && past) tally.absentHalves = 1;
    return tally;
  }
  if (row.dayType === 'full') tally.fullHalves = 2;
  else if (row.dayType === 'half') tally.halfDays = 1;
  else if (row.dayType === 'absent') tally.absentHalves = 2;
  return tally;
}
