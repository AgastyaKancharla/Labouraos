import { PricingPolicy } from '@prisma/client';

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
