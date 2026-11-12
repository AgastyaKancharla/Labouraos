import { BadRequestException } from '@nestjs/common';
import { lastFullWeek, weekLabel, weekStarting } from './weekly-report.service';

describe('Weekly report weeks (India time, Monday to Sunday)', () => {
  it('on Monday 9 AM IST takes the week that just ended', () => {
    const week = lastFullWeek(new Date('2026-11-16T03:30:00Z')); // Mon 16 Nov, 09:00 IST
    expect(week.start).toBe('2026-11-09');
    expect(week.end).toBe('2026-11-15');
    expect(week.from.toISOString()).toBe('2026-11-08T18:30:00.000Z');
    expect(week.to.toISOString()).toBe('2026-11-15T18:29:59.999Z');
  });

  it('uses the IST day, not the UTC one', () => {
    // Sun 15 Nov 23:59 UTC is already Mon 16 Nov 05:29 IST.
    expect(lastFullWeek(new Date('2026-11-15T23:59:00Z')).start).toBe('2026-11-09');
    // Sun 15 Nov 18:00 UTC is Sun 23:30 IST: the last full week is 2–8 Nov.
    expect(lastFullWeek(new Date('2026-11-15T18:00:00Z')).start).toBe('2026-11-02');
  });

  it('labels a week the way the screens do', () => {
    expect(weekLabel(weekStarting('2026-11-09'))).toBe('9–15 Nov');
    expect(weekLabel(weekStarting('2026-11-30'))).toBe('30 Nov – 6 Dec');
  });

  it('refuses a week that does not start on a Monday or is not a date', () => {
    expect(() => weekStarting('2026-11-10')).toThrow(BadRequestException);
    expect(() => weekStarting('last week')).toThrow(BadRequestException);
  });
});
