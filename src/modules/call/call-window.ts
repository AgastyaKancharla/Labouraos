import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return minutesOfDay(Number(match[1]), Number(match[2]));
}

/** Inclusive of both ends. The bounds come from stored policy or the candidate's window. */
export function isWithinClockWindow(now: Date, start: string, end: string): boolean {
  const parts = getCalendarPartsInTimezone(now);
  const current = minutesOfDay(parts.hour, parts.minute);
  const startMin = parseClock(start);
  const endMin = parseClock(end);
  if (startMin === null || endMin === null) {
    return false;
  }
  return current >= startMin && current <= endMin;
}
