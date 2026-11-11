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
