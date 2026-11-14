/**
 * Replacement-claim dates are Indian calendar days (IST, UTC+5:30): "the
 * worker left on 12 Nov", "joined on 1 Oct", "today". Comparing them as
 * instants made a worker who joined and left on the same day, or a claim made
 * between 00:00 and 05:30 IST, come out a day off.
 */
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-12" for an instant (its IST day) or for a date typed as a calendar day. Null if not a date. */
export function istDayOf(value: Date | string): string | null {
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) {
    const day = value.trim();
    return Number.isNaN(new Date(`${day}T00:00:00Z`).getTime()) ? null : day;
  }
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 00:00 IST on that day, as an instant. */
export function istDayStart(day: string): Date {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - IST_OFFSET_MS);
}

/** Whole calendar days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS);
}

export function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}
