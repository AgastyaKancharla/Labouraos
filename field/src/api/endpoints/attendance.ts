import type { ApiClient } from '../client';

/** GET /attendance/today (src/modules/attendance/attendance.service.ts TodayView). */
export interface AttendanceToday {
  /** IST date label, e.g. "2026-11-09". */
  date: string;
  /** Current status (start_of_day, available, on_visit, travelling, short_break…) or null before login. */
  status: string | null;
  loginAt: string | null;
  logoutAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  shortfallSeconds: number;
  /** The agent's own shift (decided 21 Nov) or the company shift: "HH:MM" in IST; now is the server time (ISO). */
  clocks: { shiftStart: string; shiftEnd: string; now: string };
  /** True when clocks are the agent's own shift. */
  ownShift?: boolean;
  /** Ended with Log out today: "Resume my day" is offered (decided 21 Nov). */
  canResume?: boolean;
  /** When the current status started (ISO), null before login and after logout. */
  statusSince?: string | null;
  /** Allowances from Settings (lunch, short break, "Still there?"). */
  policy?: { lunchMinutes: number; shortBreakMinutes: number; idleAfterMinutes: number };
  /** Time in Start of day (22 Nov): unproductive. */
  startOfDaySeconds?: number;
  /** False while today's day (opened at sign-in) has no saved location yet: the app saves it next. */
  locationSaved?: boolean;
  /** The day opens at sign-in in Start of day (22 Nov): no Log in button. */
  startsAtSignIn?: boolean;
  flagged: boolean;
  closedReason: string | null;
  dayType: string;
  /** "first" / "second" on a day with a half day of leave: half the production is needed (owner decision 12 Nov). */
  leaveHalf?: string | null;
}

export interface AttendanceLoginBody {
  latitude: number;
  longitude: number;
}

export const attendanceApi = (api: ApiClient) => ({
  today: () => api.get<AttendanceToday>('/attendance/today'),
  /**
   * Field agents must send their location; the server refuses without it. Since 22 Nov the day
   * opens at sign-in; this saves the day's location when the sign-in had none.
   */
  login: (body: AttendanceLoginBody) => api.post<AttendanceToday>('/attendance/login', body),
  logout: () => api.post<AttendanceToday>('/attendance/logout'),
  setStatus: (status: string) => api.post<AttendanceToday>('/attendance/status', { status }),
  /**
   * presence: the app is open in front of the agent (about once a minute);
   * activity: a tap. The server keeps him present and counts "Still there?" from taps (decided 21 Nov).
   */
  heartbeat: (kind: 'presence' | 'activity' = 'activity') => api.post<unknown>('/attendance/heartbeat', { kind }),
  /** "Resume my day" after a Log out by mistake, the same day. */
  resume: () => api.post<AttendanceToday>('/attendance/resume'),
});
