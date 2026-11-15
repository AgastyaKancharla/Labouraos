/**
 * Quiet hours and the notification day, in India time (Q21, C18). India has
 * no daylight saving, so IST is always UTC+05:30 and plain arithmetic is exact.
 * Times are stored in UTC (AGENTS.md section 2); these helpers only decide.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function minutesOf(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Bad time "${hhmm}" (expected HH:MM)`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since IST midnight for an instant. */
export function istMinuteOfDay(now: Date): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** The instant of IST midnight that starts the day `now` falls in. */
export function istDayStart(now: Date): Date {
  const istMs = now.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(istMs / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

/** True between quietStart and quietEnd IST (window may cross midnight: 21:00 to 09:00). */
export function isQuietTime(now: Date, quietStart: string, quietEnd: string): boolean {
  const minute = istMinuteOfDay(now);
  const start = minutesOf(quietStart);
  const end = minutesOf(quietEnd);
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** The next instant quiet hours end (quietEnd IST), strictly after `now`'s quiet period began. */
export function quietEndsAt(now: Date, quietEnd: string): Date {
  const endToday = new Date(istDayStart(now).getTime() + minutesOf(quietEnd) * 60 * 1000);
  return endToday.getTime() > now.getTime() ? endToday : new Date(endToday.getTime() + DAY_MS);
}
