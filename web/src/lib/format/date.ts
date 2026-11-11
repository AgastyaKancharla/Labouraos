/**
 * Dates. The API stores and returns UTC (AGENTS.md §2 rule 5); everything a
 * person sees is in IST (Asia/Kolkata, UTC+05:30, no daylight saving).
 * Always format through these helpers — never `toLocaleString()` without a
 * time zone, which would show the viewer's machine time.
 */
export const IST_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000;

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Not a date: ${String(value)}`);
  return d;
}

function parts(value: DateInput) {
  const d = toDate(value);
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(), // 0-11
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(), // 0 = Sunday
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number) => String(n).padStart(2, '0');

/** "30 Oct 2026" */
export function formatDateIST(value: DateInput): string {
  const p = parts(value);
  return `${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** "30 Oct" */
export function formatDayMonthIST(value: DateInput): string {
  const p = parts(value);
  return `${p.day} ${MONTHS[p.month]}`;
}

/** "14:02" (24-hour, as in the designs' tables) */
export function formatTimeIST(value: DateInput): string {
  const p = parts(value);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "30 Oct 14:02" */
export function formatDateTimeIST(value: DateInput): string {
  return `${formatDayMonthIST(value)} ${formatTimeIST(value)}`;
}

/** "Thursday, 30 Oct 2026" */
export function formatLongDateIST(value: DateInput): string {
  const p = parts(value);
  return `${WEEKDAYS[p.weekday]}, ${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** "October" — the month label used in "Money · October". */
export function formatMonthIST(value: DateInput): string {
  return MONTHS_LONG[parts(value).month];
}

/** The IST calendar day as yyyy-mm-dd (the value of an <input type="date">). */
export function istDateKey(value: DateInput): string {
  const p = parts(value);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
}

/** The UTC instant of 00:00 IST on the given yyyy-mm-dd day. */
export function istStartOfDay(dateKey: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) throw new RangeError(`Expected yyyy-mm-dd, got ${dateKey}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - IST_OFFSET_MS);
}

/** The last millisecond of the given IST day, as a UTC instant. */
export function istEndOfDay(dateKey: string): Date {
  return new Date(istStartOfDay(dateKey).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Adds whole days to a yyyy-mm-dd key. */
export function addDaysToKey(dateKey: string, days: number): string {
  const start = istStartOfDay(dateKey);
  return istDateKey(new Date(start.getTime() + days * 24 * 60 * 60 * 1000));
}

/** "morning" before 12:00 IST, "afternoon" before 17:00, then "evening". */
export function istPartOfDay(value: DateInput): 'morning' | 'afternoon' | 'evening' {
  const h = parts(value).hour;
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

/** Age in whole years on the given day (for the 18+ date-of-birth rule). */
export function ageOn(dateOfBirthKey: string, todayKey: string): number {
  const [by, bm, bd] = dateOfBirthKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}
