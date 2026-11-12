import { IST_OFFSET_MS, istDay } from './finance-rules';

/**
 * Pure payroll rules (Phase 22 Part B, specs/phase-22.md). Amounts are integer
 * paise; days are counted in half days so nothing is a float. Time is passed in.
 *
 * Master Guide: "Payroll comes only from attendance: the month's attendance
 * (full days, half days, leave, shortfall not made up) becomes the salary
 * sheet"; "Shortfall not made up by month end is deducted from salary"; "No
 * login and no approved leave is absent (unpaid)"; weekly days off and public
 * holidays are paid days off; "Staff pay: monthly salary, no commission".
 * Owner decisions (11 Nov, 12 Nov): a day's pay is the monthly salary ÷ 26 in
 * every month; loss of pay is that per absent or unpaid-leave working day and
 * half for a half day. Someone who joins, leaves or is away part of the month
 * is paid for the days actually on staff: salary ÷ 26 × working days on staff,
 * never more than the full salary (the leaving day is on staff); someone on
 * staff the whole month gets the full salary. Absences come off after that.
 * Net pay is never below ₹0 and keeps its paise.
 */

/** A month key (yyyy-mm) that exists. */
export function isMonthKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100;
}

/** Days in a calendar month (28–31). */
export function calendarDaysIn(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The fixed divisor for a day's pay (owner decision 11 Nov: 26 in every month; Settings `payrollSalaryDays`). */
export const DEFAULT_SALARY_DAYS = 26;
export function salaryDaysFor(policyDays: number | null | undefined): number {
  return typeof policyDays === 'number' && Number.isInteger(policyDays) && policyDays >= 20 && policyDays <= 31 ? policyDays : DEFAULT_SALARY_DAYS;
}

/** First and last IST day keys of a month. */
export function monthDays(month: string): { first: string; last: string } {
  return { first: `${month}-01`, last: `${month}-${String(calendarDaysIn(month)).padStart(2, '0')}` };
}

/** 00:00 IST on the 1st, and the last millisecond of the month in IST, as UTC instants. */
export function monthBounds(month: string): { from: Date; to: Date } {
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS);
  const to = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS - 1);
  return { from, to };
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** "October 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })} ${y}`;
}

/**
 * The month's sheet can be prepared once the month is over (the 1st of the next
 * month, IST), when every day's attendance is final.
 */
export function canPrepareOn(month: string, now: Date): boolean {
  return monthEnded(month, now);
}

/** A month has ended once the 1st of the next month has begun (IST). */
export function monthEnded(month: string, now: Date): boolean {
  return istDay(now) >= `${nextMonth(month)}-01`;
}

/** A period away (deactivated): days strictly after `leftDay` and before `returnedDay` are not on the staff. */
export interface AwayPeriod {
  leftDay: string;
  returnedDay: string | null;
}

/** Whether the person was on the staff on a day: on or after joining, and not away (the leaving day is on the staff). */
export function onStaffOn(day: string, joinedDay: string, away: readonly AwayPeriod[]): boolean {
  if (day < joinedDay) return false;
  return !away.some((p) => day > p.leftDay && (p.returnedDay === null || day < p.returnedDay));
}

/**
 * The month's working days (yyyy-mm-dd, weekly offs and holidays left out)
 * split into those the person was on the staff and those they were not.
 */
export function staffWorkingDays(workingDays: readonly string[], joinedDay: string, away: readonly AwayPeriod[]): { employed: string[]; notEmployed: number } {
  const employed = workingDays.filter((d) => onStaffOn(d, joinedDay, away));
  return { employed, notEmployed: workingDays.length - employed.length };
}

/**
 * Statutory deductions. The company is not registered yet, so none is applied:
 * each prints as a zero line "added after registration" until the CA confirms
 * them (Master Guide: "PF and ESI are added once the company is registered (a
 * question for the CA, with Karnataka professional tax)").
 */
export const STATUTORY_DEDUCTIONS = [
  { key: 'pf', label: 'Provident fund (PF)' },
  { key: 'esi', label: 'ESI' },
  { key: 'professional_tax', label: 'Professional tax' },
] as const;
export const STATUTORY_NOTE = 'Added after company registration';

/**
 * How the monthly salary is shown on the payslip (standard corporate format,
 * as on the approved payslip design): basic 50%, house rent allowance 20%,
 * special allowance the rest. It only splits the same gross for display — the
 * CA may change the split; the pay itself does not change.
 */
export function earningsSplit(monthlyPaise: number): { basicPaise: number; hraPaise: number; specialPaise: number } {
  const basicPaise = Math.round(monthlyPaise / 2);
  const hraPaise = Math.round(monthlyPaise / 5);
  return { basicPaise, hraPaise, specialPaise: monthlyPaise - basicPaise - hraPaise };
}

/** a × b / c rounded to the nearest paisa, all whole numbers. */
function mulDivRound(a: number, b: number, c: number): number {
  if (c <= 0) return 0;
  return Math.round((a * b) / c);
}

export interface PayInput {
  monthlyPaise: number;
  /** The fixed divisor (26). */
  salaryDays: number;
  /** Working days in the month the person was on the staff. */
  employedWorkingDays: number;
  /** Working days in the month the person was not on the staff (before joining, away, after leaving). */
  notEmployedWorkingDays: number;
  /** Absent and unpaid-leave working days ×2, + 1 for each half day, + unmarked working days ×2. */
  lossOfPayHalfDays: number;
  /** Shortfall not made up by month end, in whole minutes. */
  shortfallMinutes: number;
  /** Production minutes in a full day (Settings: productionHoursFullDay × 60). */
  fullDayMinutes: number;
  /** A change carried from an earlier approved month (+ pays back, − takes back). */
  correctionPaise?: number;
}

export interface PayResult {
  basicPaise: number;
  hraPaise: number;
  specialPaise: number;
  grossPaise: number;
  /**
   * What the days on staff earn before absences: the full salary when on staff
   * the whole month, otherwise salary ÷ 26 × working days on staff, never more
   * than the full salary.
   */
  earnedPaise: number;
  /** The salary not earned for the part of the month not on staff (monthly − earned). */
  notEmployedPaise: number;
  lossOfPayHalfDays: number;
  paidHalfDays: number;
  lossOfPayPaise: number;
  shortfallPaise: number;
  pfPaise: number;
  esiPaise: number;
  professionalTaxPaise: number;
  deductionsPaise: number;
  /** The part of the correction applied on this sheet (± paise). */
  correctionPaise: number;
  /** A take-back left over because it was larger than this month's pay (≤ 0); goes on the next sheet. */
  carryForwardPaise: number;
  netPaise: number;
}

/**
 * One person's pay for a month (owner decisions 11 Nov; Master Guide 12 Nov).
 * A day's pay is the monthly salary ÷ 26. On staff the whole month: the full
 * salary (weekly offs and holidays paid, whatever the number of working days).
 * Joined, left or away part of the month: paid for the days actually on
 * staff — salary ÷ 26 × working days on staff, never more than the full
 * salary — so joining on the last working day always pays one day. Then loss
 * of pay takes salary ÷ 26 per absent, unpaid-leave or unmarked working day
 * and half that for a half day, and shortfall not made up takes the day's pay
 * pro rata per production minute, both capped at what was earned. Net is
 * never below zero and keeps its paise; a take-back larger than the month's
 * pay is carried forward (carryForwardPaise), never dropped.
 */
export function computePay(input: PayInput): PayResult {
  if (!Number.isSafeInteger(input.monthlyPaise) || input.monthlyPaise < 0) throw new Error('monthlyPaise must be whole paise');
  const monthly = input.monthlyPaise;
  const days = Math.max(1, input.salaryDays);
  const split = earningsSplit(monthly);
  const notEmployedDays = Math.max(0, input.notEmployedWorkingDays);
  const employedDays = Math.max(0, input.employedWorkingDays);
  const wholeMonth = notEmployedDays === 0;
  const earnedPaise = wholeMonth ? monthly : Math.min(monthly, mulDivRound(monthly, employedDays, days));
  const notEmployedPaise = monthly - earnedPaise;
  const lostHalfDays = Math.max(0, input.lossOfPayHalfDays);
  const lossOfPayPaise = Math.min(earnedPaise, mulDivRound(monthly, lostHalfDays, days * 2));
  const shortfallPaise = Math.min(earnedPaise - lossOfPayPaise, mulDivRound(monthly, Math.max(0, input.shortfallMinutes), days * Math.max(1, input.fullDayMinutes)));
  const pfPaise = 0;
  const esiPaise = 0;
  const professionalTaxPaise = 0;
  const deductionsPaise = notEmployedPaise + lossOfPayPaise + shortfallPaise + pfPaise + esiPaise + professionalTaxPaise;
  const wanted = input.correctionPaise ?? 0;
  const beforeCorrection = monthly - deductionsPaise;
  // A take-back larger than this month's pay: apply what fits, carry the rest.
  const carryForwardPaise = Math.min(0, beforeCorrection + wanted);
  const correctionPaise = wanted - carryForwardPaise;
  // Days paid out of the 26: all of them on staff the whole month, else the days on staff (at most 26).
  const baseDays = wholeMonth ? days : Math.min(days, employedDays);
  return {
    ...split,
    grossPaise: monthly,
    earnedPaise,
    notEmployedPaise,
    lossOfPayHalfDays: lostHalfDays,
    paidHalfDays: Math.max(0, baseDays * 2 - lostHalfDays),
    lossOfPayPaise,
    shortfallPaise,
    pfPaise,
    esiPaise,
    professionalTaxPaise,
    deductionsPaise,
    correctionPaise,
    carryForwardPaise,
    netPaise: Math.max(0, beforeCorrection + correctionPaise),
  };
}

/** Attendance loss of pay in half days: absent, unpaid leave and unmarked days are whole days, a half day loses half. */
export function lossOfPayHalfDays(days: { absentDays: number; unpaidLeaveDays: number; halfDays: number; unmarkedDays?: number }): number {
  return days.absentDays * 2 + days.unpaidLeaveDays * 2 + days.halfDays + (days.unmarkedDays ?? 0) * 2;
}

/** "Seventeen thousand four hundred eighteen rupees" for the payslip (Indian numbering). */
export function rupeesInWords(paise: number): string {
  const rupees = Math.floor(Math.max(0, paise) / 100);
  const p = Math.max(0, paise) % 100;
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`);
  const three = (n: number) => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return [h ? `${ones[h]} hundred` : '', r ? two(r) : ''].filter(Boolean).join(' ');
  };
  const words = (n: number): string => {
    if (n === 0) return 'zero';
    const parts: string[] = [];
    const crore = Math.floor(n / 10_000_000);
    const lakh = Math.floor((n % 10_000_000) / 100_000);
    const thousand = Math.floor((n % 100_000) / 1000);
    const rest = n % 1000;
    if (crore) parts.push(`${words(crore)} crore`);
    if (lakh) parts.push(`${two(lakh)} lakh`);
    if (thousand) parts.push(`${two(thousand)} thousand`);
    if (rest) parts.push(three(rest));
    return parts.join(' ');
  };
  const text = `${words(rupees)} rupee${rupees === 1 ? '' : 's'}${p ? ` and ${two(p)} paise` : ''}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Filing reminders for a month (FN-Tax "Dates"; the CA confirms each):
 * GSTR-1 by the 11th of the next month, GSTR-3B (pay GST) by the 20th, TDS
 * deducted by Laboura paid by the 7th, TDS returns every quarter.
 */
export function filingDates(month: string): { gstr1: string; gstr3b: string; tdsPay: string; tdsReturn: string } {
  const nm = nextMonth(month);
  const [y, m] = month.split('-').map(Number);
  // Quarterly TDS returns: Apr–Jun by 31 Jul, Jul–Sep by 31 Oct, Oct–Dec by 31 Jan, Jan–Mar by 31 May.
  const q = m >= 4 && m <= 6 ? `${y}-07-31` : m >= 7 && m <= 9 ? `${y}-10-31` : m >= 10 ? `${y + 1}-01-31` : `${y}-05-31`;
  return { gstr1: `${nm}-11`, gstr3b: `${nm}-20`, tdsPay: `${nm}-07`, tdsReturn: q };
}
