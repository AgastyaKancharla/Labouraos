import { formatTimeIST } from '../../../lib/format/date';

/** 29 040 s → "8h 04m"; 0 → "0m"; null → "—". */
export function hm(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** 250 s → "4m 10s". */
export function ms(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** Clock time in IST or a dash. */
export function timeOrDash(iso: string | null | undefined): string {
  return iso ? formatTimeIST(iso) : '—';
}

export const ROLE_LABEL: Record<string, string> = {
  ceo: 'CEO-level',
  manager: 'Manager',
  team_lead: 'Team Lead',
  call_agent: 'Call agent',
  field_agent: 'Field agent',
  finance: 'Finance',
};

export function roleLabel(role: string | null | undefined): string {
  return role ? (ROLE_LABEL[role] ?? role) : '—';
}

/** Two-letter initials for the avatar circles. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export const LIVE_STATUS: Record<string, { label: string; tone: 'good' | 'info' | 'warn' | 'danger' | 'muted' | 'crit' }> = {
  available: { label: 'Available', tone: 'good' },
  on_call: { label: 'On call', tone: 'info' },
  after_call_notes: { label: 'After-call notes', tone: 'info' },
  on_visit: { label: 'On visit', tone: 'info' },
  travelling: { label: 'Travelling', tone: 'info' },
  team_meeting: { label: 'Team meeting', tone: 'muted' },
  training: { label: 'Training', tone: 'muted' },
  one_to_one: { label: 'One-to-one', tone: 'muted' },
  system_problem: { label: 'System problem', tone: 'warn' },
  short_break: { label: 'Short break', tone: 'warn' },
  lunch: { label: 'Lunch', tone: 'warn' },
  idle: { label: 'Idle', tone: 'warn' },
  on_leave: { label: 'On leave', tone: 'muted' },
  logged_out: { label: 'Logged out', tone: 'muted' },
  not_logged_in: { label: 'Not logged in', tone: 'danger' },
};

export function liveLabel(status: string | null | undefined): { label: string; tone: 'good' | 'info' | 'warn' | 'danger' | 'muted' | 'crit' } {
  return (status && LIVE_STATUS[status]) || { label: status ? status.replace(/_/g, ' ') : '—', tone: 'muted' };
}
