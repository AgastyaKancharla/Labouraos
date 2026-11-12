import { BadRequestException } from '@nestjs/common';
import { DAY_MS, istDayKey, istStartOfDay } from '../ceo-portal/ceo-common';

/**
 * Pure helpers for the Manager portal read endpoints: the month a screen
 * plans for, "at this speed" forecasts and the plain "Will we make it?"
 * words the designs use. Time is always passed in.
 */

export const AGENT_ROLES = ['call_agent', 'field_agent'];

export interface MonthWindow {
  year: number;
  month: number;
  /** yyyy-mm */
  key: string;
  from: Date;
  to: Date;
  daysInMonth: number;
  /** Days gone, counting today (0 for a future month, all of them for a past month). */
  dayOfMonth: number;
  daysLeft: number;
}

/** The IST calendar month an instant falls in, with how much of it has gone by `now`. */
export function monthWindow(at: Date, now: Date): MonthWindow {
  const [year, month] = istDayKey(at).split('-').map(Number);
  return monthOf(year, month, now);
}

export function monthOf(year: number, month: number, now: Date): MonthWindow {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new BadRequestException('year must be a 4-digit year');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException('month must be 1 to 12');
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const nextIdx = year * 12 + month;
  const nextKey = `${Math.floor(nextIdx / 12)}-${String((nextIdx % 12) + 1).padStart(2, '0')}`;
  const from = istStartOfDay(`${key}-01`);
  const to = new Date(istStartOfDay(`${nextKey}-01`).getTime() - 1);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let dayOfMonth: number;
  if (now.getTime() < from.getTime()) dayOfMonth = 0;
  else if (now.getTime() > to.getTime()) dayOfMonth = daysInMonth;
  else dayOfMonth = Number(istDayKey(now).slice(8, 10));
  return { year, month, key, from, to, daysInMonth, dayOfMonth, daysLeft: daysInMonth - dayOfMonth };
}

/** The month before. */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** Rounded to one decimal place, never NaN. */
export function oneDecimal(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export interface Forecast {
  target: number | null;
  done: number;
  /** null when there is no target. */
  stillToDo: number | null;
  /** Needed each day for the days left, one decimal; null without a target or with no days left. */
  needPerDay: number | null;
  /** Doing each day so far, one decimal. */
  doingPerDay: number;
  /** Where we end on the last day if we keep the same daily speed. */
  atThisSpeed: number;
  /** extra = at this speed − target (negative = short); null without a target. */
  extra: number | null;
  verdict: 'yes' | 'short' | 'no_target';
}

/**
 * "At this speed": done so far ÷ days gone × days in the month (guide,
 * Manager home — "141 in 9 days becomes 470 by the 30th"). `lowerIsBetter`
 * is for a limit (placed people who left within 30 days: "4 or fewer").
 */
export function forecast(done: number, target: number | null | undefined, m: Pick<MonthWindow, 'dayOfMonth' | 'daysInMonth' | 'daysLeft'>, lowerIsBetter = false): Forecast {
  const doingPerDay = m.dayOfMonth > 0 ? done / m.dayOfMonth : 0;
  const atThisSpeed = m.dayOfMonth > 0 ? Math.round(doingPerDay * m.daysInMonth) : done;
  if (target === null || target === undefined) {
    return { target: null, done, stillToDo: null, needPerDay: null, doingPerDay: oneDecimal(doingPerDay), atThisSpeed, extra: null, verdict: 'no_target' };
  }
  const stillToDo = Math.max(0, target - done);
  const needPerDay = !lowerIsBetter && m.daysLeft > 0 ? oneDecimal(stillToDo / m.daysLeft) : null;
  const extra = lowerIsBetter ? target - atThisSpeed : atThisSpeed - target;
  return {
    target,
    done,
    stillToDo: lowerIsBetter ? null : stillToDo,
    needPerDay,
    doingPerDay: oneDecimal(doingPerDay),
    atThisSpeed,
    extra,
    verdict: extra >= 0 ? 'yes' : 'short',
  };
}

/** Out of every 10, one decimal ("6.5"). null when there is nothing to divide by. */
export function outOfTen(part: number, whole: number): number | null {
  if (!whole) return null;
  return oneDecimal((part * 10) / whole);
}

/** "Out of every 100", whole number. */
export function outOfHundred(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part * 100) / whole);
}

export interface WeekSlice {
  label: string;
  from: Date;
  to: Date;
  soFar: boolean;
}

/**
 * The month cut into weeks the way the designs count them: days 1–7, 8–14,
 * 15–21, 22–28 and 29–end. Weeks that have not started are left out; the
 * current week ends at `now` and is marked "so far".
 */
export function monthWeeks(m: MonthWindow, now: Date): WeekSlice[] {
  const out: WeekSlice[] = [];
  const monthName = new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  for (let start = 1, n = 1; start <= m.daysInMonth; start += 7, n += 1) {
    const end = Math.min(m.daysInMonth, start + 6);
    const from = new Date(m.from.getTime() + (start - 1) * DAY_MS);
    if (from.getTime() > now.getTime()) break;
    const fullTo = new Date(m.from.getTime() + end * DAY_MS - 1);
    const soFar = fullTo.getTime() > now.getTime();
    out.push({ label: `Week ${n} · ${start}–${end} ${monthName}${soFar ? ', so far' : ''}`, from, to: soFar ? now : fullTo, soFar });
  }
  return out;
}

/** A sentence-case role word for a person in a team ("Call", "Field", "Team Lead"). */
export function roleShort(role: string, isIntern = false): string {
  const base = role === 'call_agent' ? 'Call' : role === 'field_agent' ? 'Field' : role === 'team_lead' ? 'Team Lead' : role;
  return isIntern ? `${base} (intern)` : base;
}
