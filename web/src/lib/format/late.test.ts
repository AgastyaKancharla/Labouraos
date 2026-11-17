import { describe, expect, it } from 'vitest';
import { formatLateMinutes } from './late';

describe('formatLateMinutes (late login, 17 Nov)', () => {
  it('under 60 minutes in minutes', () => {
    expect(formatLateMinutes(47)).toBe('47 min');
    expect(formatLateMinutes(1)).toBe('1 min');
    expect(formatLateMinutes(59)).toBe('59 min');
  });
  it('60 and over in hours and minutes, "1 h" when the minutes are 0', () => {
    expect(formatLateMinutes(60)).toBe('1 h');
    expect(formatLateMinutes(65)).toBe('1 h 5 min');
    expect(formatLateMinutes(125)).toBe('2 h 5 min');
    expect(formatLateMinutes(180)).toBe('3 h');
    expect(formatLateMinutes(601)).toBe('10 h 1 min');
  });
  it('nothing, negative or fractional values', () => {
    expect(formatLateMinutes(0)).toBe('0 min');
    expect(formatLateMinutes(null)).toBe('0 min');
    expect(formatLateMinutes(undefined)).toBe('0 min');
    expect(formatLateMinutes(-5)).toBe('0 min');
    expect(formatLateMinutes(59.6)).toBe('1 h');
  });
});
