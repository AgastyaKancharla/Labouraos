import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  ageOn,
  formatDateIST,
  formatDateTimeIST,
  formatLongDateIST,
  istDateKey,
  istEndOfDay,
  istPartOfDay,
  istStartOfDay,
} from './date';

describe('IST date helpers', () => {
  it('shows the IST day even when UTC is still on the previous day', () => {
    // 20:00 UTC on 29 Oct = 01:30 IST on 30 Oct
    const d = new Date('2026-10-29T20:00:00Z');
    expect(istDateKey(d)).toBe('2026-10-30');
    expect(formatDateIST(d)).toBe('30 Oct 2026');
    expect(formatDateTimeIST(d)).toBe('30 Oct 01:30');
    expect(formatLongDateIST(d)).toBe('Friday, 30 Oct 2026');
  });

  it('converts IST day boundaries to UTC instants', () => {
    expect(istStartOfDay('2026-11-01').toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(istEndOfDay('2026-11-01').toISOString()).toBe('2026-11-01T18:29:59.999Z');
    expect(() => istStartOfDay('1/11/2026')).toThrow(RangeError);
  });

  it('adds days across month ends', () => {
    expect(addDaysToKey('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('greets by IST time of day', () => {
    expect(istPartOfDay(new Date('2026-11-11T03:00:00Z'))).toBe('morning'); // 08:30 IST
    expect(istPartOfDay(new Date('2026-11-11T08:00:00Z'))).toBe('afternoon'); // 13:30 IST
    expect(istPartOfDay(new Date('2026-11-11T13:00:00Z'))).toBe('evening'); // 18:30 IST
  });

  it('computes age in whole years for the 18+ rule', () => {
    expect(ageOn('2008-11-11', '2026-11-11')).toBe(18);
    expect(ageOn('2008-11-12', '2026-11-11')).toBe(17);
  });
});
