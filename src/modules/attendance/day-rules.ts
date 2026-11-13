import { PricingPolicy } from '@prisma/client';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';

export type DayRulePolicy = Pick<
  PricingPolicy,
  'productionHoursFullDay' | 'halfDayBelowHours' | 'dayToleranceMinutes'
>;

export interface DayResult {
  dayType: 'full' | 'half' | 'off';
  shortfallSeconds: number;
  makeUpSeconds: number;
}

/**
 * Master Guide, Attendance: below 8 production hours the missing time is
 * shortfall; under 4.5 production hours is a half day; a daily tolerance
 * applies at both lines (so 7h 52m is a full day with 10 minutes' tolerance).
 *
 * - production >= full line - tolerance: full, no shortfall
 * - production <  half line - tolerance: half (a half day carries no shortfall)
 * - in between: full, shortfall = full line - production
 * Production above the full line is make-up time for the same month.
 *
 * A day worked on a weekly day off is `off`: no shortfall, and all of its
 * production is make-up time.
 *
 * A day with a half day of leave (owner decision 12 Nov: "the other half is a
 * normal working half day") needs half the production: both lines are halved
 * (4 hours for the full line, 2¼ hours for the half line with the default
 * Settings), the tolerance stays the same. `full` then means the working half
 * was worked; `half` means it was not (under the halved half line), which
 * costs half a day like any half day.
 */
export function classifyDay(
  productionSeconds: number,
  policy: DayRulePolicy,
  weeklyOff = false,
  halfDayLeave = false,
): DayResult {
  const production = Math.max(0, Math.floor(productionSeconds));
  if (weeklyOff) {
    return { dayType: 'off', shortfallSeconds: 0, makeUpSeconds: production };
  }
  const share = halfDayLeave ? 2 : 1;
  const fullLine = Math.round((policy.productionHoursFullDay * 3600) / share);
  const halfLine = Math.round((policy.halfDayBelowHours * 3600) / share);
  const tolerance = Math.max(0, policy.dayToleranceMinutes) * 60;
  const makeUpSeconds = Math.max(0, production - fullLine);
  if (production >= fullLine - tolerance) {
    return { dayType: 'full', shortfallSeconds: 0, makeUpSeconds };
  }
  if (production < halfLine - tolerance) {
    return { dayType: 'half', shortfallSeconds: 0, makeUpSeconds: 0 };
  }
  return { dayType: 'full', shortfallSeconds: fullLine - production, makeUpSeconds: 0 };
}

/** Shortfall left after the month's make-up time. Never below zero. */
export function deductibleShortfall(shortfallSeconds: number, makeUpSeconds: number): number {
  return Math.max(0, shortfallSeconds - makeUpSeconds);
}

/** IST weekday (0 = Sunday) of a date stored as an IST calendar date at UTC midnight. */
export function weekdayOf(date: Date): number {
  return date.getUTCDay();
}

export function isWeeklyOff(date: Date, weeklyOffDays: number[]): boolean {
  return weeklyOffDays.includes(weekdayOf(date));
}

/** "2026-11" → first and last IST calendar dates of that month, at UTC midnight. */
export function monthRange(month: string): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { from, to };
}

/**
 * Minutes late past the grace, for a login at `loginAt` (IST). On a day with
 * the first half on leave the working half starts half way through the shift,
 * so lateness counts from there (owner decision 12 Nov: the other half is a
 * normal working half day).
 */
export function lateMinutesFor(
  loginAt: Date,
  policy: Pick<PricingPolicy, 'shiftStart' | 'shiftEnd' | 'lateGraceMinutes'>,
  leaveHalf: string | null = null,
): number {
  const parts = getCalendarPartsInTimezone(loginAt);
  const toMinutes = (hhmm: string) => {
    const [hour, minute] = hhmm.split(':').map((part) => Number(part));
    return hour * 60 + minute;
  };
  const loginMinutes = parts.hour * 60 + parts.minute;
  const shiftStart = toMinutes(policy.shiftStart);
  const startMinutes =
    leaveHalf === 'first' ? shiftStart + Math.floor((toMinutes(policy.shiftEnd) - shiftStart) / 2) : shiftStart;
  const lateBy = loginMinutes - startMinutes;
  return lateBy <= policy.lateGraceMinutes ? 0 : lateBy;
}

/** The production seconds a full day needs: half of it on a day with a half day of leave. */
export function productionTargetSeconds(policy: Pick<PricingPolicy, 'productionHoursFullDay'>, halfDayLeave = false): number {
  return Math.round((policy.productionHoursFullDay * 3600) / (halfDayLeave ? 2 : 1));
}
