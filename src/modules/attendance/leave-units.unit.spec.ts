import { computePay, lossOfPayHalfDays } from '../finance/payroll-rules';
import { classifyDay } from './day-rules';
import { dayTally, daysLabel, leaveFieldsFor, leaveHalvesOf, splitPaid } from './leave-units';

/** Half-day leave (owner decision 12 Nov), the pure rules: halves, the split, the day and the pay. */
describe('half-day leave rules', () => {
  const policy = { productionHoursFullDay: 8, halfDayBelowHours: 4.5, dayToleranceMinutes: 10 };
  const H = 3600;
  const M = 60;

  it('counts leave in half days: a half day is one half, a full day two, split when the balance ran out half way', () => {
    expect(leaveHalvesOf({ dayType: 'leave', leaveKind: 'casual', leaveUnpaid: false, leaveHalf: 'first' })).toEqual({ total: 1, paid: 1, unpaid: 0 });
    expect(leaveHalvesOf({ dayType: 'full', leaveKind: 'casual', leaveUnpaid: true, leaveHalf: 'second' })).toEqual({ total: 1, paid: 0, unpaid: 1 });
    expect(leaveHalvesOf({ dayType: 'leave', leaveKind: 'casual', leaveUnpaid: false })).toEqual({ total: 2, paid: 2, unpaid: 0 });
    expect(leaveHalvesOf({ dayType: 'leave', leaveKind: 'casual', leaveUnpaid: false, leavePartUnpaid: true })).toEqual({ total: 2, paid: 1, unpaid: 1 });
    expect(leaveHalvesOf({ dayType: 'leave', leaveKind: 'emergency', leaveUnpaid: true })).toEqual({ total: 2, paid: 0, unpaid: 2 });
    // A full leave day the person logged in on is a working day: no leave.
    expect(leaveHalvesOf({ dayType: 'full', leaveKind: 'casual', leaveUnpaid: false })).toEqual({ total: 0, paid: 0, unpaid: 0 });
  });

  it('splits leave between the paid balance and unpaid leave in halves, in date order', () => {
    // 1½ days left, two full days asked: 1½ paid, ½ unpaid.
    expect(splitPaid(3, [2, 2])).toEqual({ perDay: [{ paid: 2, unpaid: 0 }, { paid: 1, unpaid: 1 }], paidHalves: 3, unpaidHalves: 1 });
    // Nothing left: a half day is unpaid.
    expect(splitPaid(0, [1])).toEqual({ perDay: [{ paid: 0, unpaid: 1 }], paidHalves: 0, unpaidHalves: 1 });
    expect(leaveFieldsFor(2, 1, null)).toEqual({ leaveUnpaid: false, leavePartUnpaid: true, leaveHalf: null });
    expect(leaveFieldsFor(1, 0, 'second')).toEqual({ leaveUnpaid: true, leavePartUnpaid: false, leaveHalf: 'second' });
    expect(daysLabel(0.5)).toBe('½');
    expect(daysLabel(2.5)).toBe('2½');
    expect(daysLabel(3)).toBe('3');
  });

  it('needs half the production on a half day of leave: 4 hours is the full line, 2¼ the half line, tolerance unchanged', () => {
    expect(classifyDay(3 * H + 50 * M, policy, false, true)).toMatchObject({ dayType: 'full', shortfallSeconds: 0 });
    expect(classifyDay(3 * H + 30 * M, policy, false, true)).toMatchObject({ dayType: 'full', shortfallSeconds: 30 * M });
    expect(classifyDay(2 * H + 5 * M, policy, false, true)).toMatchObject({ dayType: 'full', shortfallSeconds: H + 55 * M });
    expect(classifyDay(2 * H + 4 * M, policy, false, true)).toMatchObject({ dayType: 'half', shortfallSeconds: 0 });
    expect(classifyDay(5 * H, policy, false, true)).toMatchObject({ dayType: 'full', makeUpSeconds: H });
    // The same production on a normal day is a half day.
    expect(classifyDay(3 * H + 50 * M, policy).dayType).toBe('half');
  });

  it('tallies a half day of leave as half leave and a working half (worked, or absent)', () => {
    expect(dayTally({ dayType: 'full', leaveKind: 'casual', leaveUnpaid: false, leaveHalf: 'first' })).toMatchObject({ fullHalves: 1, absentHalves: 0, paidLeaveHalves: 1, unpaidLeaveHalves: 0 });
    expect(dayTally({ dayType: 'half', leaveKind: 'casual', leaveUnpaid: true, leaveHalf: 'first' })).toMatchObject({ fullHalves: 0, halfDays: 0, absentHalves: 1, unpaidLeaveHalves: 1 });
    // Never logged in: the working half is absent.
    expect(dayTally({ dayType: 'leave', leaveKind: 'emergency', leaveUnpaid: false, leaveHalf: 'second' })).toMatchObject({ absentHalves: 1, paidLeaveHalves: 1, emergencyPaidHalves: 1 });
    // Ordinary days are unchanged.
    expect(dayTally({ dayType: 'full', leaveKind: null, leaveUnpaid: false })).toMatchObject({ fullHalves: 2 });
    expect(dayTally({ dayType: 'half', leaveKind: null, leaveUnpaid: false })).toMatchObject({ halfDays: 1 });
    expect(dayTally({ dayType: 'absent', leaveKind: null, leaveUnpaid: false })).toMatchObject({ absentHalves: 2 });
  });

  it('payroll: an unpaid half day of leave is half a day of loss of pay (÷ 26 ÷ 2), a paid one nothing, in whole paise', () => {
    const base = { monthlyPaise: 2_600_000, salaryDays: 26, employedWorkingDays: 26, notEmployedWorkingDays: 0, shortfallMinutes: 0, fullDayMinutes: 480 };
    const unpaidHalf = lossOfPayHalfDays({ absentDays: 0, unpaidLeaveDays: 0.5, halfDays: 0 });
    expect(unpaidHalf).toBe(1);
    expect(computePay({ ...base, lossOfPayHalfDays: unpaidHalf })).toMatchObject({ lossOfPayPaise: 50_000, netPaise: 2_550_000, paidHalfDays: 51 });
    const paidHalf = lossOfPayHalfDays({ absentDays: 0, unpaidLeaveDays: 0, halfDays: 0 });
    expect(computePay({ ...base, lossOfPayHalfDays: paidHalf })).toMatchObject({ lossOfPayPaise: 0, netPaise: 2_600_000 });
    // An odd salary keeps whole paise: ₹25,001 ÷ 52 = ₹480.79 (48,079 paise).
    const odd = computePay({ ...base, monthlyPaise: 2_500_100, lossOfPayHalfDays: 1 });
    expect(odd.lossOfPayPaise).toBe(48_079);
    expect(Number.isInteger(odd.netPaise)).toBe(true);
    // Half a day unpaid leave plus the working half not worked: a whole day.
    expect(lossOfPayHalfDays({ absentDays: 0.5, unpaidLeaveDays: 0.5, halfDays: 0 })).toBe(2);
  });
});
