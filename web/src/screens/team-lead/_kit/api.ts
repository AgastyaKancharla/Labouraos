import './tl.css';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';

/** Shapes of the shared requests backend (GET /requests/*) and the Team Lead endpoints (GET /team-lead/*). */
export interface Brief {
  id: string;
  code: string;
  name: string;
  role: string;
}

export interface RequestView {
  ref: string;
  kind: 'leave' | 'correction' | 'device' | 'claim' | 'hit_removal' | 'target_change' | 'day_change' | 'written_warning';
  id: string;
  title: string;
  summary: string;
  about: { type: 'staff' | 'job_seeker' | 'placement'; id: string; code: string; name: string } | null;
  person: Brief | null;
  requestedBy: Brief | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  where: 'with_team_lead' | 'with_manager' | 'with_ceo' | 'decided';
  withTeamLead: boolean;
  withManager: boolean;
  withCeo: boolean;
  decider: 'team_lead' | 'manager' | 'ceo' | null;
  deciderStaff: Brief | null;
  routeReason: string;
  routeReasonText: string;
  whyWithYou: string | null;
  whyWithYouText: string | null;
  alert: string | null;
  createdAt: string;
  dueAt: string | null;
  forwarded: { at: string; by: Brief | null; note: string | null } | null;
  decided: { at: string; by: Brief | null; role: string | null; reason: string | null } | null;
  overturned: { at: string; by: Brief | null; reason: string | null } | null;
  canDecide: boolean;
  canForward: boolean;
  canOverturn: boolean;
  details: Record<string, unknown>;
}

export interface RequestDetail extends RequestView {
  history: { at: string; text: string }[];
}

export interface PaceRow {
  target: number | null;
  done: number;
  stillToDo: number | null;
  needPerDay: number | null;
  doingPerDay: number;
  daysLeft: number;
  projection: number;
  verdict: string | null;
  onTrack: boolean | null;
}

export interface TeamTargets {
  year: number;
  month: number;
  dayOfMonth: number;
  daysInMonth: number;
  daysLeft: number;
  team: Array<PaceRow & { key: string; label: string; hint: string }>;
  agents: Array<PaceRow & { staff: Brief; mainLabel: string; second: { label: string; done: number; target: number | null } }>;
}

export interface TeamInfo {
  lead: Brief;
  teamName: string | null;
  manager: Brief | null;
  members: Brief[];
}

export interface LiveRow {
  staff: Brief;
  status: string;
  since: string | null;
  loginAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakSeconds: number;
  breakOverSeconds: number;
  overBreak: boolean;
  idle: boolean;
}

export interface TodayCounts {
  asOf: string;
  totals: { calls: number; registered: number; paid: number; visits: number; businesses: number; interviews: number };
  agents: Array<{ staff: Brief; calls: number; registered: number; paid: number; visits: number; businesses: number; interviews: number }>;
}

export const useTeam = () => useQuery({ queryKey: ['team-lead', 'team'], queryFn: () => api.get<TeamInfo>('/team-lead/team'), staleTime: 60_000 });
export const useTargets = () => useQuery({ queryKey: ['team-lead', 'targets'], queryFn: () => api.get<TeamTargets>('/team-lead/targets') });
export const useWaiting = () => useQuery({ queryKey: ['requests', 'waiting'], queryFn: () => api.get<RequestView[]>('/requests/waiting'), refetchInterval: 60_000 });
export const useOpenRequests = () => useQuery({ queryKey: ['requests', 'open'], queryFn: () => api.get<RequestView[]>('/requests/open'), refetchInterval: 60_000 });
export const useLive = () =>
  useQuery({ queryKey: ['attendance', 'live'], queryFn: () => api.get<{ asOf: string; counts: Record<string, number>; people: LiveRow[] }>('/attendance/live'), refetchInterval: 10_000 });
export const useToday = () => useQuery({ queryKey: ['team-lead', 'today'], queryFn: () => api.get<TodayCounts>('/team-lead/today'), refetchInterval: 60_000 });

/** First name for the friendly lines ("Priya can see it too"). */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').split(' ')[0] || '—';
}

/** "26 h", "3 h", "40 min", "2 d" since an instant. */
export function waitedFor(iso: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** Plain words for a live status. */
export const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  on_call: 'On a call',
  after_call_notes: 'After-call notes',
  on_visit: 'On a visit',
  travelling: 'Travelling',
  team_meeting: 'Team meeting',
  training: 'Training',
  one_to_one: 'One-to-one',
  system_problem: 'System problem',
  short_break: 'Short break',
  lunch: 'Lunch',
  idle: 'Idle',
  not_logged_in: 'Not logged in',
  logged_out: 'Logged out',
  on_leave: 'On leave',
};

export function statusTone(row: { status: string; overBreak?: boolean }): 'good' | 'info' | 'danger' | 'warn' | 'muted' {
  if (row.overBreak) return 'danger';
  if (row.status === 'available') return 'good';
  if (['on_call', 'after_call_notes', 'on_visit', 'team_meeting', 'training', 'one_to_one'].includes(row.status)) return 'info';
  if (['idle', 'not_logged_in', 'system_problem'].includes(row.status)) return 'warn';
  return 'muted';
}

/** "On a call · 04:12", "Break · 2 min over" for the live board. */
export function liveText(row: LiveRow, now: Date, allowanceMinutes?: number): string {
  const label = STATUS_LABEL[row.status] ?? row.status;
  if (!row.since) return label;
  const secs = Math.max(0, Math.floor((now.getTime() - new Date(row.since).getTime()) / 1000));
  if (row.status === 'on_call' || row.status === 'after_call_notes') {
    return `${label} · ${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }
  if (row.overBreak) {
    const over = allowanceMinutes ? Math.max(1, Math.floor(secs / 60) - allowanceMinutes) : null;
    return over ? `${label} · ${over} min over` : `${label} · over`;
  }
  return label;
}
