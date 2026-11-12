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

  // Owner rule (Master Guide, 12 Nov): someone who joins, leaves or is away part
  // of the month is paid for the days actually on staff — salary ÷ 26 × working
  // days on staff, never more than the full salary — then absences come off.
  // On staff the whole month: the full salary less absences. (Replaces the
  // re-check-of-12-Nov tests that took salary ÷ 26 off per working day NOT on
  // staff, which paid ₹3,000 to a joiner of 28 Oct and ₹25,000 to a joiner on
  // the 2nd working day.) All on ₹26,000, so ₹1,000 a day.
  /** A synthetic month of `n` working days (the dates only need to sort). */
  const monthOf = (n: number) => Array.from({ length: n }, (_, i) => `2027-03-${String(i + 1).padStart(2, '0')}`);
  const payFor = (working: readonly string[], joinedDay: string, away: Parameters<typeof staffWorkingDays>[2] = [], over: Partial<Parameters<typeof computePay>[0]> = {}) => {
    const w = staffWorkingDays(working, joinedDay, away);
    return { w, p: pay({ employedWorkingDays: w.employed.length, notEmployedWorkingDays: w.notEmployed, ...over }) };
  };

  it.each([24, 25, 26, 27])('on staff all month in a month with %i working days: ₹26,000', (n) => {
    const { w, p } = payFor(monthOf(n), '2026-01-01');
    expect(w.notEmployed).toBe(0);
    expect(p.earnedPaise).toBe(2600000);
    expect(p.notEmployedPaise).toBe(0);
    expect(p.netPaise).toBe(2600000);
    expect(p.paidHalfDays).toBe(52);
  });

  it('joined on the last working day of a 27-working-day month: ₹1,000', () => {
    const { w, p } = payFor(october, '2026-10-31');
    expect(w.employed).toEqual(['2026-10-31']);
    expect(p.earnedPaise).toBe(100000);
    expect(p.notEmployedPaise).toBe(2500000);
    expect(p.netPaise).toBe(100000);
    expect(p.paidHalfDays).toBe(2);
  });

  it('joined on the last working day of a 24-working-day month: ₹1,000', () => {
    const month = monthOf(24);
    const { w, p } = payFor(month, month[23]);
    expect(w.employed).toHaveLength(1);
    expect(p.netPaise).toBe(100000);
  });

  it('joined on the 2nd working day of a 27-working-day month (26 on staff): ₹26,000', () => {
    const { w, p } = payFor(october, '2026-10-02');
    expect(w.employed).toHaveLength(26);
    expect(w.notEmployed).toBe(1);
    expect(p.notEmployedPaise).toBe(0);
    expect(p.netPaise).toBe(2600000);
    expect(p.paidHalfDays).toBe(52);
  });

  it('joined on the 2nd working day of a 24-working-day month (23 on staff): ₹23,000', () => {
    const month = monthOf(24);
    const { w, p } = payFor(month, month[1]);
    expect(w.employed).toHaveLength(23);
    expect(p.earnedPaise).toBe(2300000);
    expect(p.notEmployedPaise).toBe(300000);
    expect(p.netPaise).toBe(2300000);
    expect(p.paidHalfDays).toBe(46);
  });

  it('joined 28 Oct 2026 (4 working days on staff): ₹4,000', () => {
    const { w, p } = payFor(october, '2026-10-28');
    expect(w.employed).toHaveLength(4);
    expect(p.earnedPaise).toBe(400000);
    expect(p.notEmployedPaise).toBe(2200000);
    expect(p.netPaise).toBe(400000);
    expect(p.paidHalfDays).toBe(8);
  });

  it('left 10 Oct 2026 (leaving day paid): days on staff × ₹1,000', () => {
    const { w, p } = payFor(october, '2026-01-01', [{ leftDay: '2026-10-10', returnedDay: null }]);
    // 1–3 and 5–10 October (4 Oct is a Sunday): 9 working days on staff, the leaving day included.
    expect(w.employed).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
    expect(p.netPaise).toBe(w.employed.length * 100000);
    expect(p.netPaise).toBe(900000);
  });

  it('away 6 working days in a 27-working-day month (21 on staff): ₹21,000', () => {
    // Left Sat 10 Oct (paid), back Mon 19 Oct: away 12–17 Oct = 6 working days (11 Oct is a Sunday).
    const { w, p } = payFor(october, '2026-01-01', [{ leftDay: '2026-10-10', returnedDay: '2026-10-19' }]);
    expect(w.notEmployed).toBe(6);
    expect(w.employed).toHaveLength(21);
    expect(p.notEmployedPaise).toBe(500000);
    expect(p.netPaise).toBe(2100000);
  });

  it('joined mid-month with 10 days on staff and 2 absences: ₹8,000', () => {
    // Joined Wed 21 Oct: 21–24 and 26–31 October = 10 working days on staff.
    const { w, p } = payFor(october, '2026-10-21', [], { lossOfPayHalfDays: lossOfPayHalfDays({ absentDays: 2, unpaidLeaveDays: 0, halfDays: 0 }) });
    expect(w.employed).toHaveLength(10);
    expect(p.earnedPaise).toBe(1000000);
    expect(p.lossOfPayPaise).toBe(200000);
    expect(p.netPaise).toBe(800000);
    expect(p.paidHalfDays).toBe(16);
  });

  it('never pays more than the full salary, even with more than 26 working days on staff', () => {
    // A 31-working-day month (no weekly off in Settings), joined on the 3rd: 29 days on staff.
    const { w, p } = payFor(monthOf(31), '2027-03-03');
    expect(w.employed).toHaveLength(29);
    expect(p.earnedPaise).toBe(2600000);
    expect(p.notEmployedPaise).toBe(0);
    expect(p.netPaise).toBe(2600000);
    expect(p.paidHalfDays).toBe(52);
  });

  it('caps loss of pay and shortfall at what the days on staff earned, never below ₹0', () => {
    // Joined 28 Oct (₹4,000 earned), every one of those days absent, plus shortfall.
    const { p } = payFor(october, '2026-10-28', [], { lossOfPayHalfDays: 8, shortfallMinutes: 600 });
    expect(p.lossOfPayPaise).toBe(400000);
    expect(p.shortfallPaise).toBe(0);
    expect(p.netPaise).toBe(0);
    expect(p.paidHalfDays).toBe(0);
    const over = pay({ employedWorkingDays: 4, notEmployedWorkingDays: 23, lossOfPayHalfDays: 20 });
    expect(over.lossOfPayPaise).toBe(400000);
    expect(over.netPaise).toBe(0);
  });

  it('pays ₹0 when not on staff on any working day', () => {
    const p = pay({ employedWorkingDays: 0, notEmployedWorkingDays: 27 });
    expect(p.notEmployedPaise).toBe(2600000);
    expect(p.earnedPaise).toBe(0);
    expect(p.netPaise).toBe(0);
    expect(p.paidHalfDays).toBe(0);
  });

  it('full month absent: ₹0, never negative (27 working days, every day absent)', () => {
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
    // Joined 28 Oct: ₹4,000 earned; a ₹5,000 take-back applies ₹4,000 and carries ₹1,000.
    const p = pay({ employedWorkingDays: 4, notEmployedWorkingDays: 23, correctionPaise: -500000 });
    expect(p.netPaise).toBe(0);
    expect(p.correctionPaise).toBe(-400000);
    expect(p.carryForwardPaise).toBe(-100000);
    expect(p.correctionPaise + p.carryForwardPaise).toBe(-500000);
  });

  it('carries a take-back larger than a full month\'s pay forward too', () => {
    const p = pay({ correctionPaise: -3000000 });
    expect(p.netPaise).toBe(0);
    expect(p.correctionPaise).toBe(-2600000);
    expect(p.carryForwardPaise).toBe(-400000);
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
