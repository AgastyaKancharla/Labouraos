import { describe, expect, it } from 'vitest';
import { customPeriod, periodFor, periodRangeLabel, periodToUtcRange } from './period';

const NOW = new Date('2026-11-09T06:00:00Z'); // Monday 9 Nov, 11:30 IST

describe('date presets', () => {
  it('builds Today / This week / This month as the designs label them', () => {
    expect(periodFor('today', NOW)).toEqual({ preset: 'today', from: '2026-11-09', to: '2026-11-09' });
    expect(periodFor('week', NOW)).toEqual({ preset: 'week', from: '2026-11-03', to: '2026-11-09' });
    expect(periodFor('month', NOW)).toEqual({ preset: 'month', from: '2026-11-01', to: '2026-11-09' });
  });

  it('labels ranges', () => {
    expect(periodRangeLabel(periodFor('month', NOW))).toBe('1–9 Nov');
    expect(periodRangeLabel(periodFor('today', NOW))).toBe('9 Nov');
    expect(periodRangeLabel(customPeriod('2026-10-28', '2026-11-03'))).toBe('28 Oct – 3 Nov');
  });

  it('swaps a reversed custom range', () => {
    expect(customPeriod('2026-11-09', '2026-11-01')).toEqual({ preset: 'custom', from: '2026-11-01', to: '2026-11-09' });
  });

  it('turns a period into UTC API parameters', () => {
    expect(periodToUtcRange(periodFor('today', NOW))).toEqual({
      fromDate: '2026-11-08T18:30:00.000Z',
      toDate: '2026-11-09T18:29:59.999Z',
    });
  });
});
