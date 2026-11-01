import {
  DEFAULT_BUSINESS_TIMEZONE,
  getTimezoneForCity,
  getCalendarPartsInTimezone,
  getYearMonthForDate,
  getPeriodBoundaries,
  isWithinPeriod,
  isPastPeriod,
} from './period-boundary';

describe('PeriodBoundary and Timezone Bucketing', () => {
  describe('Timezone Resolution', () => {
    it('defaults to Asia/Kolkata when city is not provided or null', () => {
      expect(DEFAULT_BUSINESS_TIMEZONE).toBe('Asia/Kolkata');
      expect(getTimezoneForCity(null)).toBe('Asia/Kolkata');
      expect(getTimezoneForCity(undefined)).toBe('Asia/Kolkata');
      expect(getTimezoneForCity('')).toBe('Asia/Kolkata');
    });

    it('derives timezone from known Indian and international cities (case-insensitive)', () => {
      expect(getTimezoneForCity('Bengaluru')).toBe('Asia/Kolkata');
      expect(getTimezoneForCity('bengaluru')).toBe('Asia/Kolkata');
      expect(getTimezoneForCity('Bangalore')).toBe('Asia/Kolkata');
      expect(getTimezoneForCity('Mumbai')).toBe('Asia/Kolkata');
      expect(getTimezoneForCity('Delhi')).toBe('Asia/Kolkata');
      expect(getTimezoneForCity('Hyderabad')).toBe('Asia/Kolkata');
      expect(getTimezoneForCity('Chennai')).toBe('Asia/Kolkata');
      expect(getTimezoneForCity('Pune')).toBe('Asia/Kolkata');

      // International expansion seam
      expect(getTimezoneForCity('Dubai')).toBe('Asia/Dubai');
      expect(getTimezoneForCity('Singapore')).toBe('Asia/Singapore');
      expect(getTimezoneForCity('London')).toBe('Europe/London');
    });

    it('passes through valid IANA timezone string directly', () => {
      expect(getTimezoneForCity('Asia/Tokyo')).toBe('Asia/Tokyo');
      expect(getTimezoneForCity('America/New_York')).toBe('America/New_York');
    });
  });

  describe('Period Boundaries for Asia/Kolkata (UTC+5:30)', () => {
    it('computes exact UTC start and end for November 2026', () => {
      const boundary = getPeriodBoundaries(2026, 11, 'Asia/Kolkata');

      // 00:00:00.000 IST on Nov 1 is 2026-10-31T18:30:00.000Z
      expect(boundary.startUtc.toISOString()).toBe('2026-10-31T18:30:00.000Z');

      // 00:00:00.000 IST on Dec 1 is 2026-11-30T18:30:00.000Z
      expect(boundary.nextMonthStartUtc.toISOString()).toBe('2026-11-30T18:30:00.000Z');

      // 23:59:59.999 IST on Nov 30 is 2026-11-30T18:29:59.999Z
      expect(boundary.endUtc.toISOString()).toBe('2026-11-30T18:29:59.999Z');
      expect(boundary.daysInMonth).toBe(30);
    });

    it('handles December to January transition correctly', () => {
      const boundary = getPeriodBoundaries(2026, 12, 'Asia/Kolkata');

      // 00:00:00.000 IST on Dec 1, 2026 is 2026-11-30T18:30:00.000Z
      expect(boundary.startUtc.toISOString()).toBe('2026-11-30T18:30:00.000Z');

      // 00:00:00.000 IST on Jan 1, 2027 is 2026-12-31T18:30:00.000Z
      expect(boundary.nextMonthStartUtc.toISOString()).toBe('2026-12-31T18:30:00.000Z');

      // 23:59:59.999 IST on Dec 31, 2026 is 2026-12-31T18:29:59.999Z
      expect(boundary.endUtc.toISOString()).toBe('2026-12-31T18:29:59.999Z');
      expect(boundary.daysInMonth).toBe(31);
    });
  });

  describe('Boundary Case Requirements', () => {
    const octoberPeriod = getPeriodBoundaries(2026, 10, 'Asia/Kolkata');
    const novemberPeriod = getPeriodBoundaries(2026, 11, 'Asia/Kolkata');

    it('an event at 23:30 IST on the last day of October belongs to the old month (October)', () => {
      // 2026-10-31 23:30:00 IST in UTC is 2026-10-31T18:00:00.000Z
      const eventAt2330IST = new Date('2026-10-31T18:00:00.000Z');

      const parts = getCalendarPartsInTimezone(eventAt2330IST, 'Asia/Kolkata');
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(10);
      expect(parts.day).toBe(31);
      expect(parts.hour).toBe(23);
      expect(parts.minute).toBe(30);

      const yearMonth = getYearMonthForDate(eventAt2330IST, 'Asia/Kolkata');
      expect(yearMonth).toEqual({ year: 2026, month: 10 });

      // Belongs to October period, not November
      expect(isWithinPeriod(eventAt2330IST, octoberPeriod)).toBe(true);
      expect(isWithinPeriod(eventAt2330IST, novemberPeriod)).toBe(false);
    });

    it('an event at 00:30 IST on the 1st of November belongs to the new month (November)', () => {
      // 2026-11-01 00:30:00 IST in UTC is 2026-10-31T19:00:00.000Z
      // Note that in UTC, this timestamp is still on October 31st!
      const eventAt0030IST = new Date('2026-10-31T19:00:00.000Z');

      const parts = getCalendarPartsInTimezone(eventAt0030IST, 'Asia/Kolkata');
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(11);
      expect(parts.day).toBe(1);
      expect(parts.hour).toBe(0);
      expect(parts.minute).toBe(30);

      const yearMonth = getYearMonthForDate(eventAt0030IST, 'Asia/Kolkata');
      expect(yearMonth).toEqual({ year: 2026, month: 11 });

      // Belongs to November period, not October
      expect(isWithinPeriod(eventAt0030IST, octoberPeriod)).toBe(false);
      expect(isWithinPeriod(eventAt0030IST, novemberPeriod)).toBe(true);
    });
  });

  describe('isPastPeriod and UTC 5.5-hour Loophole Prevention', () => {
    it('rejects October when now is 03:00 IST on Nov 1st (which is 21:30 UTC on Oct 31st)', () => {
      // 2026-11-01 03:00:00 IST = 2026-10-31T21:30:00.000Z
      const nowInKolkataOnNov1stEarlyMorning = new Date('2026-10-31T21:30:00.000Z');

      // In UTC, this is still 2026-10-31, so UTC would say October has not ended.
      // But in Asia/Kolkata, it is already November 1st, so October HAS ended!
      const isOctoberPast = isPastPeriod(2026, 10, nowInKolkataOnNov1stEarlyMorning, 'Asia/Kolkata');
      expect(isOctoberPast).toBe(true);

      // November is current, so it is not past
      const isNovemberPast = isPastPeriod(2026, 11, nowInKolkataOnNov1stEarlyMorning, 'Asia/Kolkata');
      expect(isNovemberPast).toBe(false);
    });

    it('allows current month and future months, but flags past months', () => {
      const midNov = new Date('2026-11-15T10:00:00.000Z');

      expect(isPastPeriod(2026, 10, midNov)).toBe(true);  // Past
      expect(isPastPeriod(2026, 11, midNov)).toBe(false); // Current
      expect(isPastPeriod(2026, 12, midNov)).toBe(false); // Future
      expect(isPastPeriod(2027, 1, midNov)).toBe(false);  // Future year
      expect(isPastPeriod(2025, 12, midNov)).toBe(true);  // Past year
    });
  });
});
