import { parseClock } from './call-window';

/**
 * When an unanswered call is tried again (Master Guide, "What happens when
 * things don't go to plan": the calling system logs it, a WhatsApp goes out
 * and a retry is scheduled).
 *
 * A no-pickup hit needs a morning AND an evening call on the same day, so the
 * retry goes to the other half of the day:
 * - missed in the morning (before 12:00 IST) → this afternoon, at 12:00 or the
 *   start of the person's window, whichever is later;
 * - missed in the afternoon or evening → tomorrow, at the start of the window.
 * Every retry stays inside the calling hours and the person's preferred
 * window. If the two don't overlap, the calling hours are used.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOON = 12 * 60;

export interface RetryWindows {
  callingHoursStart: string;
  callingHoursEnd: string;
  personWindowStart?: string | null;
  personWindowEnd?: string | null;
}

function allowedRange(w: RetryWindows): { start: number; end: number } {
  const cs = parseClock(w.callingHoursStart) ?? 9 * 60;
  const ce = parseClock(w.callingHoursEnd) ?? 21 * 60;
  const ps = w.personWindowStart ? parseClock(w.personWindowStart) : null;
  const pe = w.personWindowEnd ? parseClock(w.personWindowEnd) : null;
  if (ps === null || pe === null) return { start: cs, end: ce };
  const start = Math.max(cs, ps);
  const end = Math.min(ce, pe);
  return start < end ? { start, end } : { start: cs, end: ce };
}

/** UTC instant of `minutes` past midnight IST on the IST day that contains `istDayStartUtc`. */
function atIstMinutes(istDayStartUtc: number, minutes: number): Date {
  return new Date(istDayStartUtc + minutes * 60 * 1000);
}

export function nextRetryAt(missedAt: Date, windows: RetryWindows): Date {
  const istMs = missedAt.getTime() + IST_OFFSET_MS;
  const istMidnightAsUtc = Math.floor(istMs / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  const minuteOfDay = Math.floor((istMs % DAY_MS) / 60000);
  const { start, end } = allowedRange(windows);

  if (minuteOfDay < NOON) {
    const candidate = Math.max(NOON, start, minuteOfDay + 1);
    if (candidate < end) return atIstMinutes(istMidnightAsUtc, candidate);
  }
  return atIstMinutes(istMidnightAsUtc + DAY_MS, start);
}

/** Tomorrow (IST) at the start of the allowed window — for follow-up calls, which are retried the next day. */
export function nextDayRetryAt(missedAt: Date, windows: RetryWindows): Date {
  const istMs = missedAt.getTime() + IST_OFFSET_MS;
  const istMidnightAsUtc = Math.floor(istMs / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return atIstMinutes(istMidnightAsUtc + DAY_MS, allowedRange(windows).start);
}
