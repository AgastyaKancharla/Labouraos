import { parseClock } from '../call/call-window';

/**
 * Working-time arithmetic for the sign-up tracker, in India time. Pure: the
 * caller passes the calendar (weekly days off from Settings, public holidays
 * from the Holiday table) so tests can fix every date.
 *
 * - A **working day** is not a weekly day off and not a public holiday.
 * - The **call window** on a working day is the office working day (Settings
 *   shiftStart–shiftEnd, when agents are on shift) inside the calling hours
 *   (09:00–21:00), narrowed to the person's preferred call window when it
 *   overlaps.
 * - **Reminders** (push, in the app) follow quiet hours only: never between
 *   the end and the start of the calling hours (C18), on any day.
 */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** Never look further than this for an opening (a year of holidays would be a data error). */
const MAX_DAYS_AHEAD = 60;

export interface WorkCalendar {
  /** 0 = Sunday … 6 = Saturday (IST). */
  weeklyOffDays: number[];
  /** IST calendar dates "YYYY-MM-DD" of public holidays. */
  holidays: ReadonlySet<string>;
}

export interface ClockWindow {
  /** Minutes past IST midnight, inclusive start, exclusive end. */
  start: number;
  end: number;
}

export interface WindowSettings {
  callingHoursStart: string;
  callingHoursEnd: string;
  workdayStart: string;
  workdayEnd: string;
}

/** UTC instant of IST midnight of the IST day containing `ms`. */
export function istDayStartMs(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

/** "YYYY-MM-DD" of the IST day containing `ms`. */
export function istDateKey(ms: number): string {
  return new Date(istDayStartMs(ms) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istWeekday(dayStartMs: number): number {
  return new Date(dayStartMs + IST_OFFSET_MS).getUTCDay();
}

function istMinuteOfDay(ms: number): number {
  return Math.floor((ms - istDayStartMs(ms)) / MINUTE_MS);
}

export function isWorkingDay(dayStartMs: number, cal: WorkCalendar): boolean {
  if (cal.weeklyOffDays.includes(istWeekday(dayStartMs))) return false;
  return !cal.holidays.has(istDateKey(dayStartMs));
}

function clockOr(value: string | null | undefined, fallback: number): number {
  const parsed = value ? parseClock(value) : null;
  return parsed ?? fallback;
}

/** Calling hours alone (quiet hours are outside them). */
export function callingWindow(s: WindowSettings): ClockWindow {
  return { start: clockOr(s.callingHoursStart, 9 * 60), end: clockOr(s.callingHoursEnd, 21 * 60) };
}

/**
 * When an agent may call this person on a working day: on shift, inside the
 * calling hours and inside the person's window. If the person's window does
 * not overlap, the shift inside the calling hours is used (the existing retry
 * rule does the same).
 */
export function callWindow(s: WindowSettings, person?: { start?: string | null; end?: string | null } | null): ClockWindow {
  const calling = callingWindow(s);
  const shiftStart = clockOr(s.workdayStart, calling.start);
  const shiftEnd = clockOr(s.workdayEnd, calling.end);
  let start = Math.max(calling.start, shiftStart);
  let end = Math.min(calling.end, shiftEnd);
  if (start >= end) {
    start = calling.start;
    end = calling.end;
  }
  const ps = person?.start ? parseClock(person.start) : null;
  const pe = person?.end ? parseClock(person.end) : null;
  if (ps !== null && pe !== null) {
    const s2 = Math.max(start, ps);
    const e2 = Math.min(end, pe);
    if (s2 < e2) return { start: s2, end: e2 };
  }
  return { start, end };
}

/** The earliest instant at or after `from` that is inside `window` on a working day. */
export function nextCallableAt(from: Date, cal: WorkCalendar, window: ClockWindow): Date {
  let day = istDayStartMs(from.getTime());
  for (let i = 0; i <= MAX_DAYS_AHEAD; i += 1, day += DAY_MS) {
    if (!isWorkingDay(day, cal)) continue;
    const open = day + window.start * MINUTE_MS;
    const close = day + window.end * MINUTE_MS;
    if (from.getTime() < open) return new Date(open);
    if (from.getTime() < close) return from;
  }
  return from;
}

/**
 * "The next working morning": the start of the call window on the first
 * working day whose window opens after `from`. Stopping before the window
 * opens on a working day means this morning.
 */
export function nextWorkingMorning(from: Date, cal: WorkCalendar, window: ClockWindow): Date {
  let day = istDayStartMs(from.getTime());
  for (let i = 0; i <= MAX_DAYS_AHEAD; i += 1, day += DAY_MS) {
    const open = day + window.start * MINUTE_MS;
    if (isWorkingDay(day, cal) && open > from.getTime()) return new Date(open);
  }
  return from;
}

/**
 * `from` plus `minutes` of working time: only minutes inside the call window
 * on working days count ("2 working hours if they stopped at payment").
 */
export function addWorkingMinutes(from: Date, minutes: number, cal: WorkCalendar, window: ClockWindow): Date {
  let left = Math.max(0, minutes) * MINUTE_MS;
  let at = nextCallableAt(from, cal, window).getTime();
  for (let i = 0; i <= MAX_DAYS_AHEAD; i += 1) {
    const close = istDayStartMs(at) + window.end * MINUTE_MS;
    if (at + left <= close) return new Date(at + left);
    left -= close - at;
    at = nextCallableAt(new Date(close), cal, window).getTime();
    if (at === close) at = nextWorkingMorning(new Date(close), cal, window).getTime();
  }
  return new Date(at);
}

/**
 * A reminder `minutes` after `from`, moved out of quiet hours: one due
 * between the end of the calling hours and their start waits until the
 * start (any day of the week; reminders are not calls).
 */
export function reminderAt(from: Date, minutes: number, s: WindowSettings): Date {
  const due = from.getTime() + minutes * MINUTE_MS;
  const quiet = callingWindow(s);
  const minute = istMinuteOfDay(due);
  const day = istDayStartMs(due);
  if (minute < quiet.start) return new Date(day + quiet.start * MINUTE_MS);
  if (minute >= quiet.end) return new Date(day + DAY_MS + quiet.start * MINUTE_MS);
  return new Date(due);
}

/** Is `at` inside the window on a working day? */
export function isCallableNow(at: Date, cal: WorkCalendar, window: ClockWindow): boolean {
  return nextCallableAt(at, cal, window).getTime() === at.getTime();
}
