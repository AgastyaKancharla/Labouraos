/**
 * Display helpers. Everything is stored in UTC and shown in IST (UTC+05:30,
 * no daylight saving), worked out by hand so phones with odd Intl support
 * still show the right time.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toIst(input: Date | string | number): Date {
  const ms = input instanceof Date ? input.getTime() : new Date(input).getTime();
  return new Date(ms + IST_OFFSET_MS);
}

function clock12(hours: number, minutes: number): string {
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 === 0 ? 12 : hours % 12;
  return `${h}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** "9:12 AM" in IST. */
export function formatTimeIst(input: Date | string | number): string {
  const d = toIst(input);
  return clock12(d.getUTCHours(), d.getUTCMinutes());
}

/** "Mon 9 Nov" in IST. */
export function formatDayIst(input: Date | string | number): string {
  const d = toIst(input);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "11 Nov 2026, 2:05 PM IST" — used on photo stamps. */
export function formatStampIst(input: Date | string | number): string {
  const d = toIst(input);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${clock12(d.getUTCHours(), d.getUTCMinutes())} IST`;
}

/** Settings store shift times as "HH:MM" (IST). "09:30" → "9:30 AM". */
export function formatShiftTime(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return hhmm;
  return clock12(Number(match[1]), Number(match[2]));
}

/** Countdown "4:05" from milliseconds (never negative). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "KK" from "Kiran Kumar". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0][1] ?? '');
  return (first + last).toUpperCase();
}
