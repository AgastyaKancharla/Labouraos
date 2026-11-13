import type { ApiClient } from '../client';

/** GET /attendance/today (src/modules/attendance/attendance.service.ts TodayView). */
export interface AttendanceToday {
  /** IST date label, e.g. "2026-11-09". */
  date: string;
  /** Current status (available, on_visit, travelling, short_break…) or null before login. */
  status: string | null;
  loginAt: string | null;
  logoutAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  shortfallSeconds: number;
  /** shiftStart / shiftEnd are "HH:MM" in IST; now is the server time (ISO). */
  clocks: { shiftStart: string; shiftEnd: string; now: string };
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
  /** Field agents must send their location; the server refuses without it. */
  login: (body: AttendanceLoginBody) => api.post<AttendanceToday>('/attendance/login', body),
  logout: () => api.post<AttendanceToday>('/attendance/logout'),
  setStatus: (status: string) => api.post<AttendanceToday>('/attendance/status', { status }),
  heartbeat: () => api.post<unknown>('/attendance/heartbeat'),
});
