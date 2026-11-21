import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';

/** No automatic message goes between 9 PM and 9 AM IST (the customer app's quiet hours). */
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 9;

export function inQuietHours(now: Date): boolean {
  const hour = getCalendarPartsInTimezone(now, 'Asia/Kolkata').hour;
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}
