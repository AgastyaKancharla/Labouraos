/**
 * Small time formats for the attendance screens, all in IST (the API sends
 * UTC). Kept apart from the general date helpers because the CA14 designs
 * write times their own way: "9:31 AM", "Available · 11:20", "08:40 left",
 * "3h 34m of 8h 00m", "15m of 30m".
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function istParts(iso: string | Date): { h: number; m: number } {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}

/** "9:31 AM", "10:00 AM", "3:12 PM". */
export function clockTime(iso: string | Date): string {
  const { h, m } = istParts(iso);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "11:20", "3:12" — the short time in the header chip. */
export function shortClock(iso: string | Date): string {
  const { h, m } = istParts(iso);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}`;
}

/** "9:31" (24-hour) for table cells. */
export function hhmm(iso: string | Date): string {
  const { h, m } = istParts(iso);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** "09:30" (24-hour, two-digit hour) — the value of an <input type="time">. */
export function timeInputValue(iso: string | Date): string {
  const { h, m } = istParts(iso);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "09:30" (shift setting) → "9:30 AM". */
export function settingClock(hhmmSetting: string): string {
  const [h = 0, m = 0] = hhmmSetting.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "09:30" plus minutes → "09:40" (grace end). */
export function addMinutesToSetting(hhmmSetting: string, minutes: number): string {
  const [h = 0, m = 0] = hhmmSetting.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "3h 34m", "8h 00m", "0h 40m". */
export function hm(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

/** "15m", "0m", or "1h 20m" for longer spans. */
export function span(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  return total < 60 ? `${total}m` : hm(seconds);
}

/** "08:40" — minutes and seconds of a break timer. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** "0:52" — the "Still there?" minute. */
export function promptClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Mon 9 Nov" from an IST date key "2026-11-09". */
export function dayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d).replace(',', '');
}

/** "30 Nov" from an IST date key. */
export function dayMonth(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
}

/** "Fri 13 Nov" or "Mon 23 Nov – Fri 27 Nov". */
export function dateRange(from: string, to: string | undefined): string {
  if (!to || to === from) return dayLabel(from);
  return `${dayLabel(from)} – ${dayLabel(to)}`;
}

/** "2026-11" → "2026-10". */
export function shiftMonth(month: string, delta: number): string {
  const [y = 2026, m = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** The last calendar day of a month as a date key. */
export function lastDayOf(month: string): string {
  const [y = 2026, m = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** "November" in the person's language. */
export function monthName(month: string, language: string): string {
  const d = new Date(`${month}-01T00:00:00.000Z`);
  try {
    return new Intl.DateTimeFormat(`${language}-IN`, { month: 'long', timeZone: 'UTC' }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(d);
  }
}
