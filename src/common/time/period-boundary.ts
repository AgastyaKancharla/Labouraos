/**
 * Period Boundary & Timezone Bucketing Helper
 *
 * Domain Rule & User Ruling:
 * Timestamps are stored in UTC in the database (never local time).
 * However, MONTH BUCKETING for targets, performance metrics, and reporting
 * converts to the business timezone first. A month runs from 00:00 local time
 * on the 1st of the month to 23:59:59.999 local time on the last day of the month.
 *
 * Default business timezone is 'Asia/Kolkata' (UTC+05:30).
 * Multi-city and international expansion seam:
 * Laboura entities carry a `city` column. Cities are mapped to their respective
 * IANA timezones using `CITY_TIMEZONE_MAP`.
 */

export const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Kolkata';

/**
 * City-to-timezone mapping.
 * Laboura currently operates in Bengaluru, but records carry a `city` column
 * to support multi-city and international expansion.
 */
export const CITY_TIMEZONE_MAP: Record<string, string> = {
  bengaluru: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  hyderabad: 'Asia/Kolkata',
  chennai: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata',
  pune: 'Asia/Kolkata',
  // Documented seam for future international expansion:
  dubai: 'Asia/Dubai',
  singapore: 'Asia/Singapore',
  london: 'Europe/London',
};

/**
 * Resolves an IANA timezone identifier from a city name or timezone string.
 * Defaults to `DEFAULT_BUSINESS_TIMEZONE` ('Asia/Kolkata') if unset or unmapped.
 */
export function getTimezoneForCity(cityOrTimezone?: string | null): string {
  if (!cityOrTimezone) return DEFAULT_BUSINESS_TIMEZONE;
  const trimmed = cityOrTimezone.trim();
  if (trimmed.includes('/')) {
    return trimmed;
  }
  return CITY_TIMEZONE_MAP[trimmed.toLowerCase()] ?? DEFAULT_BUSINESS_TIMEZONE;
}

export interface CalendarParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Returns the calendar year, month (1-12), day, hour, minute, second
 * for a given UTC Date when viewed in the specified timezone.
 */
export function getCalendarPartsInTimezone(
  date: Date,
  timezoneOrCity: string = DEFAULT_BUSINESS_TIMEZONE,
): CalendarParts {
  const timeZone = getTimezoneForCity(timezoneOrCity);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  );

  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  };
}

/**
 * Returns the year and month (1-12) for a given UTC Date in the specified timezone.
 */
export function getYearMonthForDate(
  date: Date,
  timezoneOrCity: string = DEFAULT_BUSINESS_TIMEZONE,
): { year: number; month: number } {
  const parts = getCalendarPartsInTimezone(date, timezoneOrCity);
  return { year: parts.year, month: parts.month };
}

/**
 * Converts local calendar date components in a given timezone into an exact UTC Date.
 */
export function localCalendarToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number = 0,
  minute: number = 0,
  second: number = 0,
  ms: number = 0,
  timezoneOrCity: string = DEFAULT_BUSINESS_TIMEZONE,
): Date {
  const timeZone = getTimezoneForCity(timezoneOrCity);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(guess).map((p) => [p.type, p.value]),
  );

  const formattedAsUtc = new Date(
    Date.UTC(
      parseInt(parts.year, 10),
      parseInt(parts.month, 10) - 1,
      parseInt(parts.day, 10),
      parseInt(parts.hour, 10),
      parseInt(parts.minute, 10),
      parseInt(parts.second, 10),
      parseInt(parts.fractionalSecond || '0', 10),
    ),
  );

  const offsetMs = formattedAsUtc.getTime() - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

export interface PeriodBoundary {
  year: number;
  month: number; // 1-12
  timezone: string;
  startUtc: Date;          // 00:00:00.000 local on 1st of month
  endUtc: Date;            // 23:59:59.999 local on last day of month
  nextMonthStartUtc: Date; // 00:00:00.000 local on 1st of next month
  daysInMonth: number;
}

/**
 * Computes exact UTC period boundaries for a given year and month (1-12)
 * in the specified timezone.
 *
 * For example, for November 2026 in Asia/Kolkata (UTC+5:30):
 * - startUtc: 2026-10-31T18:30:00.000Z (00:00:00 IST on Nov 1)
 * - endUtc:   2026-11-30T18:29:59.999Z (23:59:59.999 IST on Nov 30)
 * - nextMonthStartUtc: 2026-11-30T18:30:00.000Z (00:00:00 IST on Dec 1)
 * - daysInMonth: 30
 */
export function getPeriodBoundaries(
  year: number,
  month: number,
  timezoneOrCity: string = DEFAULT_BUSINESS_TIMEZONE,
): PeriodBoundary {
  if (month < 1 || month > 12) {
    throw new RangeError(`Invalid month ${month}. Must be between 1 and 12.`);
  }

  const timezone = getTimezoneForCity(timezoneOrCity);
  const startUtc = localCalendarToUtc(year, month, 1, 0, 0, 0, 0, timezone);

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthStartUtc = localCalendarToUtc(nextYear, nextMonth, 1, 0, 0, 0, 0, timezone);

  const endUtc = new Date(nextMonthStartUtc.getTime() - 1);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    year,
    month,
    timezone,
    startUtc,
    endUtc,
    nextMonthStartUtc,
    daysInMonth,
  };
}

/**
 * Checks whether an event date falls within the period boundary.
 */
export function isWithinPeriod(eventDate: Date, period: PeriodBoundary): boolean {
  const time = eventDate.getTime();
  return time >= period.startUtc.getTime() && time <= period.endUtc.getTime();
}

/**
 * Checks whether a calendar month has already ended as of `now` in the target timezone.
 * Eliminates the UTC transition loophole where a Manager could set targets for a past
 * local month during the first few hours of a new local month.
 */
export function isPastPeriod(
  year: number,
  month: number,
  now: Date,
  timezoneOrCity: string = DEFAULT_BUSINESS_TIMEZONE,
): boolean {
  const parts = getCalendarPartsInTimezone(now, timezoneOrCity);
  return (
    year < parts.year ||
    (year === parts.year && month < parts.month)
  );
}
