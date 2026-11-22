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
  /** "Still there?" after this many minutes Available with no call and no click (CEO setting, 30 by default). */
  idleAfterMinutes: number;
  idlePromptMinutes: number;
  /** A console not open and visible for this long counts as away (Idle). */
  presenceMinutes?: number;
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
  /** Time in Start of day (22 Nov): unproductive, shown apart from breaks and idle. */
  startOfDaySeconds?: number;
  /**
   * The day opens at sign-in in Start of day (call agents, Team Leads, Managers; 22 Nov):
   * no "Start my day" button for them. False for Finance (and older servers leave it out).
   */
  startsAtSignIn?: boolean;
  shortfallSeconds: number;
  /** The person's own shift (decided 21 Nov) or the company shift. */
  clocks: { shiftStart: string; shiftEnd: string; now: string };
  /** True when clocks are the person's own shift. */
  ownShift?: boolean;
  /** Ended with Log out today: "Resume my day" is offered (decided 21 Nov). */
  canResume?: boolean;
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
  /** "first" / "second" on a day with a half day of leave: half the production is needed. */
  leaveHalf?: string | null;
}

/**
 * The production seconds today needs: the full-day hours from Settings, half
 * of them on a day with a half day of leave (owner decision 12 Nov).
 */
export function productionTarget(today: Pick<AttendanceToday, 'policy' | 'leaveHalf'> | null | undefined): number {
  const full = (today?.policy.productionHoursFullDay ?? 8) * 3600;
  return today?.leaveHalf ? Math.round(full / 2) : full;
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
  /** "first" / "second" on a day with a half day of leave (owner decision 12 Nov). */
  leaveHalf?: string | null;
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
  /** "first" / "second" for a half day of leave; null for full days. */
  half?: LeaveHalf | null;
  /** Whole or half days (0.5 for a half day). */
  days?: number;
  approvedDays?: number | null;
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
  /** presence: the console is open and visible (about once a minute); activity: a click or key (decided 21 Nov). */
  const heartbeat = useMutation({
    mutationFn: (kind: 'presence' | 'activity' = 'activity') => api.post<AttendanceToday>('/attendance/heartbeat', { kind }),
    onSuccess: settle,
  });
  /** "Resume my day" after a Log out by mistake, the same day (recorded). */
  const resume = useMutation({ mutationFn: () => api.post<AttendanceToday>('/attendance/resume', {}), onSuccess: settle });
  return { start, end, setStatus, heartbeat, resume };
}

/** One person on GET /attendance/shifts (decided 21 Nov: own shifts). */
export interface ShiftRow {
  staffId: string;
  code: string;
  name: string;
  role: string;
  shiftStart: string;
  shiftEnd: string;
  own: boolean;
}

export const shiftKeys = { team: ['attendance', 'shifts'] as const };

/** The people whose shift the Team Lead, Manager or CEO sets. */
export function useTeamShifts(enabled = true) {
  return useQuery({
    queryKey: shiftKeys.team,
    queryFn: () => api.get<{ companyShift: { start: string; end: string }; people: ShiftRow[] }>('/attendance/shifts'),
    enabled,
  });
}

/** Set ("HH:MM", "HH:MM") or clear (null, null) a person's own shift. */
export function useSetShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { staffId: string; shiftStart: string | null; shiftEnd: string | null }) =>
      api.put<ShiftRow>(`/attendance/shifts/${encodeURIComponent(body.staffId)}`, { shiftStart: body.shiftStart, shiftEnd: body.shiftEnd }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: shiftKeys.team }),
  });
}

/** A Team Lead, Manager or the CEO reopens today's closed day of someone in their team, with a reason. */
export function useReopenDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { dayId: string; reason: string }) =>
      api.post<{ reopened: true }>(`/attendance/days/${encodeURIComponent(body.dayId)}/reopen`, { reason: body.reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['attendance'] }),
  });
}
