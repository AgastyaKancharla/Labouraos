import { formatCountdown, formatDayIst, formatShiftTime, formatStampIst, formatTimeIst, initials, monthName, setDateLanguage } from './format';
import { formatDateKey } from '@/screens/_visits/format';
import { formatDateKey as formatFormDate } from '@/components/form';

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
    expect(initials('Sanket')).toBe('SA');
  });
});

describe('dates in the app language (A8)', () => {
  afterEach(() => setDateLanguage('en'));

  it('Kannada shows Kannada day and month names; English stays as it was', () => {
    setDateLanguage('kn');
    expect(formatDayIst('2026-11-16T05:30:00Z')).toBe('ಸೋಮ 16 ನವೆಂ');
    expect(formatDateKey('2026-11-18')).toBe('ಬುಧ 18 ನವೆಂ');
    expect(formatFormDate('2026-01-04')).toBe('ಭಾನು 4 ಜನವರಿ 2026');
    expect(monthName(7)).toBe('ಆಗ');
    setDateLanguage('en');
    expect(formatDayIst('2026-11-16T05:30:00Z')).toBe('Mon 16 Nov');
    expect(formatDateKey('2026-11-18')).toBe('Wed 18 Nov');
  });

  it('photo stamps stay in English (they are proof)', () => {
    setDateLanguage('kn');
    expect(formatStampIst('2026-11-11T08:35:00Z')).toBe('11 Nov 2026, 2:05 PM IST');
  });

  it('Hindi (hidden in Laboura Field) uses the English names', () => {
    setDateLanguage('hi');
    expect(formatDayIst('2026-11-16T05:30:00Z')).toBe('Mon 16 Nov');
  });
});
