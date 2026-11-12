/** Shapes and words for the payroll screens (FN-Salaries, the CEO's Salaries). */
export interface SheetRow {
  staffId: string;
  staffCode: string;
  name: string;
  role: string;
  joinedOn: string | null;
  monthlyPaise: number | null;
  salaryDays: number;
  calendarDays: number;
  workingDays: number;
  holidays: number;
  fullDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  /** Working days not on the staff (before joining, away, after leaving). */
  notEmployedDays: number;
  /** Working days on the staff with no attendance (not paid). */
  unmarkedDays: number;
  paidDays: number;
  lossOfPayDays: number;
  shortfallMinutes: number;
  grossPaise: number;
  notEmployedPaise: number;
  lossOfPayPaise: number;
  shortfallPaise: number;
  pfPaise: number;
  esiPaise: number;
  professionalTaxPaise: number;
  deductionsPaise: number;
  correctionPaise: number;
  correctionNote: string | null;
  netPaise: number;
  line: { id: string; status: string; paidAt: string | null; utrLast4: string | null; paidFrom: string | null } | null;
}

export type PayrollStatus = 'draft' | 'with_ceo' | 'returned' | 'approved' | 'paid';

export interface SalarySheet {
  month: string;
  label: string;
  status: PayrollStatus;
  closed: boolean;
  salaryDays: number;
  calendarDays: number;
  prepareFrom: string;
  canPrepare: boolean;
  payDay: string;
  run: {
    preparedBy: string | null;
    preparedAt: string;
    approvedBy: string | null;
    approvedAt: string | null;
    returnedBy: string | null;
    returnedAt: string | null;
    returnedReason: string | null;
    paidAt: string | null;
    netPaise: number;
  } | null;
  totals: { people: number; grossPaise: number; deductionsPaise: number; lossOfPayAndShortfallPaise: number; correctionsPaise: number; netPaise: number; paidCount: number; paidPaise: number; unpaidCount: number };
  missingSalary: { staffId: string; staffCode: string; name: string }[];
  openDays: { name: string; days: string[] }[];
  statutory: { lines: { key: string; label: string; paise: number }[]; note: string };
  rows: SheetRow[];
}

export const STAFF_ROLE: Record<string, string> = {
  call_agent: 'Call agent',
  field_agent: 'Field agent',
  team_lead: 'Team Lead',
  manager: 'Manager',
  finance: 'Finance',
  ceo: 'CEO',
};

/** "2h 49m", "—" for none. */
export function shortTime(minutes: number): string {
  if (!minutes) return '—';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** IST month key (yyyy-mm) of a date. */
export function istMonthKey(date: Date): string {
  return new Date(date.getTime() + 5.5 * 3600_000).toISOString().slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** "October", "October 2026". */
export function monthName(month: string, withYear = false): string {
  const [y, m] = month.split('-').map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' });
  return withYear ? `${name} ${y}` : name;
}

/** "30 Nov" from yyyy-mm-dd. */
export function dayMonth(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}`;
}

export function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Paid days as the design writes them: "29.5 / 31". */
export function paidDaysText(r: Pick<SheetRow, 'paidDays' | 'salaryDays'>): string {
  return `${r.paidDays} / ${r.salaryDays}`;
}
