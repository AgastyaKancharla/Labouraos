import { formatCountdown, formatDayIst, formatShiftTime, formatStampIst, formatTimeIst, initials } from './format';

describe('IST formatting', () => {
  it('shows UTC times in IST', () => {
    expect(formatTimeIst('2026-11-09T03:42:00Z')).toBe('9:12 AM');
    expect(formatTimeIst('2026-11-09T18:45:00Z')).toBe('12:15 AM');
    expect(formatDayIst('2026-11-08T20:00:00Z')).toBe('Mon 9 Nov');
    expect(formatStampIst('2026-11-11T08:35:00Z')).toBe('11 Nov 2026, 2:05 PM IST');
  });

  it('formats shift times, countdowns and initials', () => {
    expect(formatShiftTime('09:30')).toBe('9:30 AM');
    expect(formatShiftTime('18:30')).toBe('6:30 PM');
    expect(formatCountdown(299_100)).toBe('5:00');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(initials('Kiran Kumar')).toBe('KK');
    expect(initials('Ravi')).toBe('RA');
  });
});
