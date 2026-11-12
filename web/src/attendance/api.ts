import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api/client';

/**
 * The person's own attendance, leave and corrections — the same endpoints
 * Laboura Field's FA04 screens use (field/src/api/endpoints/myAttendance.ts).
 * The server always takes the person from the sign-in, never from the page,
 * and takes every time from its own clock.
 */

export interface TodaySegment {
  status: string;
  startedAt: string;
  endedAt: string | null;
  source: string;
  approved: boolean | null;
}

export interface TodayPolicy {
  productionHoursFullDay: number;
  lateGraceMinutes: number;
  shortBreakMinutes: number;
  lunchMinutes: number;
  idleAfterMinutes: number;
  idlePromptMinutes: number;
}

/** GET /attendance/today (AttendanceService TodayView). */
export interface AttendanceToday {
  date: string;
  status: string | null;
  loginAt: string | null;
  logoutAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  shortfallSeconds: number;
  clocks: { shiftStart: string; shiftEnd: string; now: string };
  flagged: boolean;
  closedReason: string | null;
  dayType: string;
  statusSince: string | null;
  shortBreakSeconds: number;
  shortBreaks: number;
  lunchSeconds: number;
  meetingSeconds: number;
  segments: TodaySegment[];
  policy: TodayPolicy;
}

/** Where the day stands, for which screen to show. */
export type DayPhase = 'not_started' | 'open' | 'ended' | 'leave';

export function dayPhase(today: AttendanceToday): DayPhase {
  if (today.loginAt && today.logoutAt) return 'ended';
  if (today.loginAt) return 'open';
  if (today.dayType === 'leave') return 'leave';
  return 'not_started';
}

/** One day of GET /attendance/month. */
export interface AttendanceDayRow {
  id: string;
  date: string;
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
  change: { byStaffId: string | null; at: string; reason: string | null } | null;
}

/** GET /attendance/month?month=YYYY-MM. */
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

/** GET /attendance/leave/balance. */
export interface LeaveBalance {
  asOfMonth: string;
  casual: KindBalance;
  emergency: KindBalance;
}

/** One of GET /attendance/requests/mine. */
export interface MyRequest {
  kind: 'leave' | 'correction';
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
  where: string;
  routeReason: string;
  createdAt: string;
  decided: { at: string; by: { id: string; code: string; name: string; role: string } | null; role: string | null; reason: string | null } | null;
  leaveKind?: 'casual' | 'emergency';
  fromDate?: string;
  toDate?: string;
  days?: number;
  approvedDays?: number | null;
  date?: string;
  startAt?: string;
  endAt?: string;
  segmentStatus?: string;
}

export interface LeaveBody {
  kind: 'casual' | 'emergency';
  fromDate: string;
  toDate: string;
  reason: string;
}

export type CorrectionStatus = 'available' | 'team_meeting' | 'training' | 'one_to_one';

export interface CorrectionBody {
  date: string;
  /** "HH:MM" in IST. */
  from: string;
  to: string;
  status: CorrectionStatus;
  reason: string;
}

export const attendanceKeys = {
  all: ['attendance'] as const,
  today: ['attendance', 'today'] as const,
  month: (month: string) => ['attendance', 'month', month] as const,
  balance: ['attendance', 'leave-balance'] as const,
  mine: ['attendance', 'requests', 'mine'] as const,
};

/** Polled every 30 s as a fallback; the live channel refreshes it at once. */
export function useAttendanceToday(enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.today,
    queryFn: () => api.get<AttendanceToday>('/attendance/today'),
    refetchInterval: 30_000,
    enabled,
  });
}

export function useAttendanceMonth(month: string) {
  return useQuery({ queryKey: attendanceKeys.month(month), queryFn: () => api.get<AttendanceMonth>('/attendance/month', { query: { month } }), enabled: Boolean(month) });
}

export function useLeaveBalance() {
  return useQuery({ queryKey: attendanceKeys.balance, queryFn: () => api.get<LeaveBalance>('/attendance/leave/balance') });
}

export function useMyRequests() {
  return useQuery({ queryKey: attendanceKeys.mine, queryFn: () => api.get<MyRequest[]>('/attendance/requests/mine') });
}

/**
 * Start my day, End my day, pick a status, heartbeat. Each answers with the
 * new today view, which goes straight into the cache; the call agent's work
 * list is refreshed too, because "Call next" only works while Available.
 */
export function useAttendanceActions() {
  const qc = useQueryClient();
  const settle = (today: AttendanceToday) => {
    qc.setQueryData(attendanceKeys.today, today);
    void qc.invalidateQueries({ queryKey: ['call-work'] });
  };
  const start = useMutation({ mutationFn: () => api.post<AttendanceToday>('/attendance/login', {}), onSuccess: (today) => {
    settle(today);
    void qc.invalidateQueries({ queryKey: ['attendance', 'month'] });
  } });
  const end = useMutation({ mutationFn: () => api.post<AttendanceToday>('/attendance/logout', {}), onSuccess: (today) => {
    settle(today);
    void qc.invalidateQueries({ queryKey: ['attendance', 'month'] });
  } });
  const setStatus = useMutation({ mutationFn: (status: string) => api.post<AttendanceToday>('/attendance/status', { status }), onSuccess: settle });
  const heartbeat = useMutation({ mutationFn: () => api.post<AttendanceToday>('/attendance/heartbeat', {}), onSuccess: settle });
  return { start, end, setStatus, heartbeat };
}
