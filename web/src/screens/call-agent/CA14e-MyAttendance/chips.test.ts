import { describe, expect, it } from 'vitest';
import { productionTarget, type AttendanceDayRow, type AttendanceToday } from '../../../attendance/api';
import { expectedDays } from './chips';

const row = (extra: Partial<AttendanceDayRow>): AttendanceDayRow => ({
  id: 'd', date: '2026-11-10', dayType: 'full', loginAt: null, logoutAt: null, lateMinutes: 0, productionSeconds: 0, breakSeconds: 0,
  shortfallSeconds: 0, makeUpSeconds: 0, flagged: false, closedReason: null, leaveKind: null, leaveUnpaid: false, change: null, ...extra,
});

/** Half-day leave (owner decision 12 Nov): half the production that day. */
describe('half-day production target', () => {
  const policy = { productionHoursFullDay: 8 } as AttendanceToday['policy'];
  it('needs 8 hours on a normal day and 4 on a day with a half day of leave', () => {
    expect(productionTarget({ policy, leaveHalf: null })).toBe(8 * 3600);
    expect(productionTarget({ policy, leaveHalf: 'first' })).toBe(4 * 3600);
    expect(productionTarget(null)).toBe(8 * 3600);
  });

  it('counts a day with a half day of leave as half an expected day, logged in or not', () => {
    expect(expectedDays([row({}), row({ dayType: 'full', leaveKind: 'casual', leaveHalf: 'second' }), row({ dayType: 'leave', leaveKind: 'casual', leaveHalf: 'first' }), row({ dayType: 'leave', leaveKind: 'casual' })])).toBe(2);
    // A half day of leave later this month (not logged in) is not expected yet.
    expect(expectedDays([row({ date: '2026-11-10' }), row({ date: '2026-11-20', dayType: 'leave', leaveKind: 'casual', leaveHalf: 'first' })], '2026-11-12')).toBe(1);
    expect(expectedDays([row({ date: '2026-11-11', dayType: 'leave', leaveKind: 'casual', leaveHalf: 'first' })], '2026-11-12')).toBe(0.5);
  });
});
