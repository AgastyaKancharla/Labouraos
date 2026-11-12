import {
  calendarDaysIn,
  canPrepareOn,
  computePay,
  earningsSplit,
  filingDates,
  isMonthKey,
  lossOfPayHalfDays,
  monthBounds,
  monthEnded,
  onStaffOn,
  rupeesInWords,
  salaryDaysFor,
  staffWorkingDays,
} from './payroll-rules';

/** Payroll rules (Phase 22 Part B; owner decisions 11 Nov) — pure, integer paise, half days. */
describe('payroll rules', () => {
  // October 2026: 31 days, Sundays 4, 11, 18, 25 → 27 working days (Mon–Sat, no holidays here).
  const october = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);
  const pay = (over: Partial<Parameters<typeof computePay>[0]>) =>
    computePay({ monthlyPaise: 2600000, salaryDays: 26, employedWorkingDays: 27, notEmployedWorkingDays: 0, lossOfPayHalfDays: 0, shortfallMinutes: 0, fullDayMinutes: 480, ...over });

  it('knows month keys and calendar days', () => {
    expect(isMonthKey('2026-10')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(calendarDaysIn('2026-10')).toBe(31);
    expect(october).toHaveLength(27);
  });

  it('divides by 26 in every month unless Settings say otherwise', () => {
    expect(salaryDaysFor(null)).toBe(26);
    expect(salaryDaysFor(undefined)).toBe(26);
    expect(salaryDaysFor(30)).toBe(30);
    expect(salaryDaysFor(5)).toBe(26);
  });

  it('bounds a month in IST', () => {
    const { from, to } = monthBounds('2026-10');
    expect(from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(to.toISOString()).toBe('2026-10-31T18:29:59.999Z');
  });

  it('prepares only once the month is over (the 1st, IST), when attendance is final', () => {
    expect(canPrepareOn('2026-10', new Date('2026-10-31T10:00:00Z'))).toBe(false);
    expect(canPrepareOn('2026-10', new Date('2026-10-31T18:29:00Z'))).toBe(false);
    expect(canPrepareOn('2026-10', new Date('2026-10-31T18:31:00Z'))).toBe(true);
    expect(monthEnded('2026-10', new Date('2026-10-31T18:31:00Z'))).toBe(true);
  });

  it('counts the days on the staff: from joining, the leaving day paid, days away not', () => {
    expect(onStaffOn('2026-10-27', '2026-10-28', [])).toBe(false);
    expect(onStaffOn('2026-10-28', '2026-10-28', [])).toBe(true);
    const away = [{ leftDay: '2026-10-10', returnedDay: '2026-10-20' }];
    expect(onStaffOn('2026-10-10', '2026-01-01', away)).toBe(true); // leaving day paid
    expect(onStaffOn('2026-10-15', '2026-01-01', away)).toBe(false);
    expect(onStaffOn('2026-10-20', '2026-01-01', away)).toBe(true); // came back
    expect(onStaffOn('2026-10-25', '2026-01-01', [{ leftDay: '2026-10-22', returnedDay: null }])).toBe(false);
    const joiner = staffWorkingDays(october, '2026-10-28', []);
    expect(joiner.employed).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
    expect(joiner.notEmployed).toBe(23);
  });

  it('counts loss of pay in half days', () => {
    expect(lossOfPayHalfDays({ absentDays: 1, unpaidLeaveDays: 1, halfDays: 1 })).toBe(5);
    expect(lossOfPayHalfDays({ absentDays: 0, unpaidLeaveDays: 0, halfDays: 0, unmarkedDays: 2 })).toBe(4);
  });

  it('splits the gross for the payslip without changing it', () => {
    expect(earningsSplit(1800000)).toEqual({ basicPaise: 900000, hraPaise: 360000, specialPaise: 540000 });
    const odd = earningsSplit(1800001);
    expect(odd.basicPaise + odd.hraPaise + odd.specialPaise).toBe(1800001);
  });

  it('pays the monthly salary for a full month, 27 working days or not, holidays and weekly offs paid', () => {
    const p = pay({});
    expect(p.netPaise).toBe(2600000);
    expect(p.paidHalfDays).toBe(52);
    expect(p.pfPaise + p.esiPaise + p.professionalTaxPaise).toBe(0);
  });

  it('takes salary ÷ 26 per absent day and half that for a half day', () => {
    // ₹18,000 ÷ 26 = ₹692.31 a day.
    expect(pay({ monthlyPaise: 1800000, lossOfPayHalfDays: 2 }).lossOfPayPaise).toBe(69231);
    expect(pay({ monthlyPaise: 1800000, lossOfPayHalfDays: 1 }).lossOfPayPaise).toBe(34615);
    expect(pay({ monthlyPaise: 1800000, lossOfPayHalfDays: 2 }).netPaise).toBe(1800000 - 69231);
  });

  // Owner rule (re-check 12 Nov): joiners, leavers and periods away take off
  // salary ÷ 26 for each working day not on the staff, exactly like absences.
  // (Replaces the earlier "salary ÷ 26 × days on the staff" tests, which paid
  // ₹4,000 to a joiner of 28 Oct and ₹26,000 to a joiner on the 2nd.)
  it('takes off salary ÷ 26 per working day not on the staff: joined on the 2nd working day of a 24-working-day month', () => {
    const month = Array.from({ length: 24 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`);
    const w = staffWorkingDays(month, month[1], []);
    expect(w.notEmployed).toBe(1);
    const p = pay({ employedWorkingDays: w.employed.length, notEmployedWorkingDays: w.notEmployed });
    expect(p.earnedPaise).toBe(2500000);
    expect(p.netPaise).toBe(2500000);
  });

  it('joined on the 2nd working day of a 27-working-day month: ₹25,000', () => {
    const w = staffWorkingDays(october, '2026-10-02', []);
    expect(w.notEmployed).toBe(1);
    expect(pay({ employedWorkingDays: w.employed.length, notEmployedWorkingDays: w.notEmployed }).netPaise).toBe(2500000);
  });

  it('away 6 working days: ₹20,000', () => {
    // Left Sat 10 Oct (paid), back Mon 19 Oct: away 12–17 Oct = 6 working days (11 Oct is a Sunday).
    const w = staffWorkingDays(october, '2026-01-01', [{ leftDay: '2026-10-10', returnedDay: '2026-10-19' }]);
    expect(w.notEmployed).toBe(6);
    const p = pay({ employedWorkingDays: w.employed.length, notEmployedWorkingDays: w.notEmployed });
    expect(p.notEmployedPaise).toBe(600000);
    expect(p.netPaise).toBe(2000000);
  });

  it('joined 28 Oct 2026 (4 on staff of 27): ₹26,000 − 23 × ₹1,000 = ₹3,000', () => {
    const w = staffWorkingDays(october, '2026-10-28', []);
    const p = pay({ employedWorkingDays: w.employed.length, notEmployedWorkingDays: w.notEmployed });
    expect(p.notEmployedPaise).toBe(2300000);
    expect(p.earnedPaise).toBe(300000);
    expect(p.netPaise).toBe(300000);
    expect(p.paidHalfDays).toBe(6);
  });

  it('left 10 Oct 2026 (leaving day paid): 18 working days not on staff taken off → ₹8,000', () => {
    const w = staffWorkingDays(october, '2026-01-01', [{ leftDay: '2026-10-10', returnedDay: null }]);
    expect(w.employed.length).toBe(9);
    expect(w.notEmployed).toBe(18);
    const p = pay({ employedWorkingDays: w.employed.length, notEmployedWorkingDays: w.notEmployed });
    expect(p.notEmployedPaise).toBe(1800000);
    expect(p.netPaise).toBe(800000);
  });

  it('never goes below ₹0 when more working days are off the staff than the divisor', () => {
    const p = pay({ employedWorkingDays: 0, notEmployedWorkingDays: 27 });
    expect(p.notEmployedPaise).toBe(2600000);
    expect(p.earnedPaise).toBe(0);
    expect(p.netPaise).toBe(0);
  });

  it('pays ₹0, never less, for a 27-working-day month with every day absent', () => {
    const p = pay({ lossOfPayHalfDays: 54, shortfallMinutes: 600 });
    expect(p.netPaise).toBe(0);
    expect(p.lossOfPayPaise).toBe(2600000);
    expect(p.shortfallPaise).toBe(0);
    expect(p.paidHalfDays).toBe(0);
  });

  it('charges shortfall not made up per production minute, and keeps paise', () => {
    // 30 minutes of an 8-hour day of ₹18,000 ÷ 26 = 69231 × 30 / 480 ≈ 4327 paise.
    const p = pay({ monthlyPaise: 1800000, shortfallMinutes: 30 });
    expect(p.shortfallPaise).toBe(4327);
    expect(p.netPaise).toBe(1795673);
  });

  it('adds a correction from an earlier approved month', () => {
    expect(pay({ correctionPaise: 100000 }).netPaise).toBe(2700000);
    expect(pay({ correctionPaise: -100000 }).netPaise).toBe(2500000);
    expect(pay({ correctionPaise: -100000 }).carryForwardPaise).toBe(0);
  });

  it('carries a take-back larger than the month\'s pay forward, never forgetting it', () => {
    const p = pay({ employedWorkingDays: 4, notEmployedWorkingDays: 23, correctionPaise: -500000 });
    expect(p.netPaise).toBe(0);
    expect(p.correctionPaise).toBe(-300000);
    expect(p.carryForwardPaise).toBe(-200000);
    expect(p.correctionPaise + p.carryForwardPaise).toBe(-500000);
  });

  it('rejects a non-integer salary', () => {
    expect(() => pay({ monthlyPaise: 10.5 })).toThrow();
  });

  it('writes the net pay in words, Indian style', () => {
    expect(rupeesInWords(1741800)).toBe('Seventeen thousand four hundred eighteen rupees');
    expect(rupeesInWords(12345600)).toBe('One lakh twenty three thousand four hundred fifty six rupees');
    expect(rupeesInWords(50)).toBe('Zero rupees and fifty paise');
  });

  it('gives the filing reminders for a month', () => {
    expect(filingDates('2026-10')).toEqual({ gstr1: '2026-11-11', gstr3b: '2026-11-20', tdsPay: '2026-11-07', tdsReturn: '2027-01-31' });
    expect(filingDates('2026-12').gstr1).toBe('2027-01-11');
    expect(filingDates('2027-02').tdsReturn).toBe('2027-05-31');
  });
});
