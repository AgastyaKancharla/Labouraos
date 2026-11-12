import { computePay, lossOfPayHalfDays, payStartDay, staffWorkingDays } from './payroll-rules';
import { firstAccrualMonth } from '../attendance/leave.service';
import { goLiveDayOf } from '../pricing/pricing.service';

/**
 * Go-live (owner decision 12 Nov): "the CEO sets a go-live date in Settings; the
 * app's payroll counts only from the later of the joining date and the go-live
 * date — days before go-live are handled outside the app, never treated as
 * absent." Part-month rule: salary ÷ 26 × (working days on staff + holidays on staff).
 */
describe('Go-live date: payroll and leave count from the later of joining and go-live', () => {
  /** November 2026 working days, Sundays off (1, 8, 15, 22, 29 Nov are Sundays): 25 days. */
  const november = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`).filter(
    (d) => new Date(`${d}T00:00:00.000Z`).getUTCDay() !== 0,
  );
  const salary = 2_600_000; // ₹26,000 a month: ₹1,000 a day

  it('starts from go-live for someone added after go-live with an earlier joining date', () => {
    expect(payStartDay('2026-11-01', '2026-11-20')).toBe('2026-11-20');
    const { employed, notEmployed } = staffWorkingDays(november, payStartDay('2026-11-01', '2026-11-20'), []);
    // 20–30 Nov without the Sundays 22 and 29: 9 working days on staff.
    expect(employed).toEqual(['2026-11-20', '2026-11-21', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-30']);
    expect(notEmployed).toBe(november.length - 9);
    // Every day from go-live worked: the days before go-live are not on staff, never loss of pay.
    const pay = computePay({ monthlyPaise: salary, salaryDays: 26, employedWorkingDays: employed.length, notEmployedWorkingDays: notEmployed, lossOfPayHalfDays: 0, shortfallMinutes: 0, fullDayMinutes: 480 });
    expect(pay.earnedPaise).toBe(900_000);
    expect(pay.lossOfPayPaise).toBe(0);
    expect(pay.netPaise).toBe(900_000);
    // Without go-live the 16 working days 1–19 Nov with no attendance would each cost a day.
    const before = staffWorkingDays(november, '2026-11-01', []);
    const unmarked = before.employed.filter((d) => d < '2026-11-20').length;
    expect(unmarked).toBe(16);
    const withoutGoLive = computePay({ monthlyPaise: salary, salaryDays: 26, employedWorkingDays: before.employed.length, notEmployedWorkingDays: before.notEmployed, lossOfPayHalfDays: lossOfPayHalfDays({ absentDays: 0, unpaidLeaveDays: 0, halfDays: 0, unmarkedDays: unmarked }), shortfallMinutes: 0, fullDayMinutes: 480 });
    expect(withoutGoLive.netPaise).toBe(salary - 1_600_000);
  });

  it('starts from the joining day for someone joining after go-live', () => {
    expect(payStartDay('2026-11-25', '2026-11-20')).toBe('2026-11-25');
    const { employed } = staffWorkingDays(november, payStartDay('2026-11-25', '2026-11-20'), []);
    expect(employed).toEqual(['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-30']);
    const pay = computePay({ monthlyPaise: salary, salaryDays: 26, employedWorkingDays: employed.length, notEmployedWorkingDays: november.length - employed.length, lossOfPayHalfDays: 0, shortfallMinutes: 0, fullDayMinutes: 480 });
    expect(pay.netPaise).toBe(500_000);
  });

  it('changes nothing when no go-live date is set', () => {
    expect(payStartDay('2026-11-05', null)).toBe('2026-11-05');
    expect(payStartDay('2026-11-05', undefined)).toBe('2026-11-05');
    expect(goLiveDayOf({ goLiveDate: null })).toBeNull();
    expect(goLiveDayOf({ goLiveDate: new Date('2026-11-20T00:00:00.000Z') })).toBe('2026-11-20');
  });

  it('starts leave accrual from the later of joining and go-live', () => {
    // Joined 15 Oct, go-live 20 Nov: nothing for November; the first leaves on 1 December.
    expect(firstAccrualMonth('2026-10-15', '2026-11-20')).toBe('2026-12');
    // Joined 25 Nov, after go-live: the joining month earns nothing; first leaves on 1 December.
    expect(firstAccrualMonth('2026-11-25', '2026-11-20')).toBe('2026-12');
    // Joined 1 Dec, go-live 20 Nov: none in December (joining month), first on 1 January.
    expect(firstAccrualMonth('2026-12-01', '2026-11-20')).toBe('2027-01');
    // Go-live on the 1st: that month's leave is earned by someone who joined earlier.
    expect(firstAccrualMonth('2026-10-15', '2026-11-01')).toBe('2026-11');
    // No go-live: from the month after joining.
    expect(firstAccrualMonth('2026-10-15', null)).toBe('2026-11');
  });
});
