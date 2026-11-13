import type { ApiClient } from '../client';

/**
 * The agent's own attendance, leave, corrections and payslips — the same
 * endpoints the call agent's CA14e–CA14h use (src/modules/attendance and
 * src/modules/finance/payroll-self.controller.ts). The server always takes the
 * person from the sign-in, never from the screen.
 */

/** One day of GET /attendance/month (AttendanceDaysService DayRow). */
export interface AttendanceDayRow {
  id: string;
  /** IST date, "2026-11-09". */
  date: string;
  /** open (today), full, half, absent, leave, off. */
  dayType: string;
  loginAt: string | null;
  logoutAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakSeconds: number;
  shortfallSeconds: number;
  makeUpSeconds: number;
  flagged: boolean;
  closedReason: string | null;
  leaveKind: string | null;
  leaveUnpaid: boolean;
  /** "first" / "second" on a day with a half day of leave (owner decision 12 Nov). */
  leaveHalf?: string | null;
  change: { byStaffId: string | null; at: string; reason: string | null } | null;
}

/** GET /attendance/month?month=YYYY-MM (MonthSummary). */
export interface AttendanceMonth {
  month: string;
  fullDays: number;
  halfDays: number;
  absentDays: number;
  paidLeaveDays: { casual: number; emergency: number; total: number };
  unpaidLeaveDays: number;
  lateLogins: { count: number; days: { date: string; minutes: number }[] };
  productionSeconds: number;
  shortfallSeconds: number;
  makeUpSeconds: number;
  deductibleShortfallSeconds: number;
  workingDays: number;
  holidays: { date: string; name: string }[];
  days: AttendanceDayRow[];
}

export interface KindBalance {
  earned: number;
  taken: number;
  paidTaken: number;
  unpaidTaken: number;
  left: number;
}

/** GET /attendance/leave/balance (LeaveService.balance). */
export interface LeaveBalance {
  asOfMonth: string;
  casual: KindBalance;
  emergency: KindBalance;
}

interface PersonBrief {
  id: string;
  code: string;
  name: string;
  role: string;
}

/** One of GET /attendance/requests/mine (AttendanceRequestsService view). */
export interface MyRequest {
  kind: 'leave' | 'correction';
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
  /** with_team_lead, with_manager, with_ceo or decided. */
  where: string;
  routeReason: string;
  createdAt: string;
  decided: { at: string; by: PersonBrief | null; role: string | null; reason: string | null } | null;
  // leave
  leaveKind?: 'casual' | 'emergency';
  fromDate?: string;
  toDate?: string;
  /** "first" / "second" for a half day of leave; null for full days. */
  half?: LeaveHalf | null;
  /** Whole or half days (0.5 for a half day). */
  days?: number;
  paidDays?: number;
  unpaidDays?: number;
  /** Set when only part of the dates was approved (the rest was rejected). */
  approvedFromDate?: string | null;
  approvedToDate?: string | null;
  approvedDays?: number | null;
  casualDaysTakenThisMonth?: number;
  // correction
  date?: string;
  startAt?: string;
  endAt?: string;
  segmentStatus?: string;
}

/** A half day of leave (owner decision 12 Nov): the first or second half of one date. */
export type LeaveHalf = 'first' | 'second';

export interface LeaveBody {
  kind: 'casual' | 'emergency';
  fromDate: string;
  toDate: string;
  reason: string;
  /** Left out for full days. */
  half?: LeaveHalf;
}

export interface CorrectionBody {
  date: string;
  /** "HH:MM" in IST. */
  from: string;
  to: string;
  status: 'available' | 'team_meeting' | 'training' | 'one_to_one';
  reason: string;
}

/** GET /payroll/my-payslips: only months Finance has paid. */
export interface PayslipMonths {
  months: { month: string; label: string; paidOn: string | null }[];
}

/** GET /payroll/my-payslips/:month (the same payslip as CA14g-Payslip). */
export interface Payslip {
  month: string;
  label: string;
  status: string;
  paidOn: string | null;
  company: { name: string; address: string | null; city: string };
  employee: {
    name: string;
    code: string;
    designation: string;
    reportsTo: string | null;
    joinedOn: string | null;
    paymentRefLast4: string | null;
    paidFrom: string | null;
  };
  days: { salaryDays: number; calendarDays: number; paidDays: number; lossOfPayDays: number; notEmployedDays: number; shortfallMinutes: number };
  earnings: { key: string; label: string; paise: number }[];
  grossPaise: number;
  deductions: { key: string; label: string; paise: number; note: string | null }[];
  deductionsPaise: number;
  correction?: { paise: number; note: string | null } | null;
  carryForwardPaise?: number;
  netPaise: number;
  netInWords: string;
  note: string;
}

export const myAttendanceApi = (api: ApiClient) => ({
  month: (month: string) => api.get<AttendanceMonth>('/attendance/month', { query: { month } }),
  balance: () => api.get<LeaveBalance>('/attendance/leave/balance'),
  requests: () => api.get<MyRequest[]>('/attendance/requests/mine'),
  /** Needs signal (sent live, never queued). */
  requestLeave: (body: LeaveBody) => api.post<MyRequest>('/attendance/leave', body),
  /** Needs signal (sent live, never queued). */
  requestCorrection: (body: CorrectionBody) => api.post<MyRequest>('/attendance/corrections', body),
  payslips: () => api.get<PayslipMonths>('/payroll/my-payslips'),
  payslip: (month: string) => api.get<Payslip>(`/payroll/my-payslips/${encodeURIComponent(month)}`),
});
