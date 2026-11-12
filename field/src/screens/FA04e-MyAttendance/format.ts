import type { AttendanceDayRow, MyRequest } from '@/api/endpoints';
import type { MessageKey } from '@/i18n';
import type { Tone } from '@/theme';
import { formatDateKey } from '../_visits/format';

/** A full day is 8 production hours (guide: Attendance, fixed shift). */
export const FULL_DAY_SECONDS = 8 * 3600;

/** "8h 04m" from seconds. */
export function hm(seconds: number): string {
  const m = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** "40m" or "1h 20m" for short spans. */
export function shortSpan(seconds: number): string {
  const m = Math.max(0, Math.round(seconds / 60));
  return m < 60 ? `${m}m` : hm(seconds);
}

/** "2026-11" → "2026-10". */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** The last calendar day of a month, as a date key. */
export function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Days the person was expected to work so far: worked, half, absent or today (not leave or days off). */
export function expectedDays(days: AttendanceDayRow[]): number {
  return days.filter((d) => d.dayType === 'full' || d.dayType === 'half' || d.dayType === 'absent' || d.dayType === 'open').length;
}

export interface Chip {
  key: MessageKey;
  params?: Record<string, string | number>;
  tone: Tone;
}

/** The "Counts as" chip of one day (CA14e table, last column). */
export function dayChip(day: AttendanceDayRow): { main: Chip; extras: Chip[] } {
  const extras: Chip[] = [];
  if (day.lateMinutes > 0 && day.dayType !== 'leave') extras.push({ key: 'fa04e.late', params: { minutes: day.lateMinutes }, tone: 'amber' });
  if (day.shortfallSeconds > 0) extras.push({ key: 'fa04e.short', params: { time: shortSpan(day.shortfallSeconds) }, tone: 'amber' });
  if (day.makeUpSeconds > 0) extras.push({ key: 'fa04e.makeUp', params: { time: shortSpan(day.makeUpSeconds) }, tone: 'green' });
  switch (day.dayType) {
    case 'open':
      return { main: { key: 'fa04e.today', tone: 'blue' }, extras: extras.filter((c) => c.key === 'fa04e.late') };
    case 'full':
      return { main: { key: 'fa04e.fullDay', tone: extras.some((c) => c.tone === 'amber') ? 'amber' : 'green' }, extras };
    case 'half':
      return { main: { key: 'fa04e.halfDay', tone: 'crit' }, extras };
    case 'absent':
      return { main: { key: 'fa04e.absent', tone: 'tomato' }, extras: [] };
    case 'leave':
      if (day.leaveUnpaid) return { main: { key: 'fa04e.unpaidLeave', tone: 'neutral' }, extras: [] };
      return { main: { key: day.leaveKind === 'emergency' ? 'fa04e.emergencyLeave' : 'fa04e.plannedLeave', tone: 'cyan' }, extras: [] };
    case 'off':
      return { main: { key: 'fa04e.offWorked', tone: 'neutral' }, extras };
    default:
      return { main: { key: 'fa04e.open', tone: 'neutral' }, extras };
  }
}

/** "Fri 13 Nov" or "Mon 23 – Fri 27 Nov". */
export function dateRange(from: string, to: string): string {
  if (!to || from === to) return formatDateKey(from);
  return `${formatDateKey(from)} – ${formatDateKey(to)}`;
}

const IST_OFFSET_MS = 330 * 60_000;
/** "9:30" (24-hour, IST) from an ISO time. */
export function hhmmIst(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** Where a pending request is, or who decided it (CA14e "My requests" tags). */
export function requestChip(r: MyRequest): Chip {
  if (r.status === 'pending') {
    if (r.where === 'with_manager') return { key: 'fa04e.req.withManager', tone: 'amber' };
    if (r.where === 'with_ceo') return { key: 'fa04e.req.withCeo', tone: 'amber' };
    return { key: 'fa04e.req.withTeamLead', tone: 'amber' };
  }
  const by = r.decided?.by?.name?.split(' ')[0] ?? '';
  if (r.status === 'approved') {
    if (r.kind === 'leave' && r.approvedDays && r.days && r.approvedDays < r.days) {
      return { key: 'fa04e.req.approvedPart', params: { approved: r.approvedDays, days: r.days }, tone: 'green' };
    }
    return by ? { key: 'fa04e.req.approvedBy', params: { name: by }, tone: 'green' } : { key: 'fa04e.req.approved', tone: 'green' };
  }
  return by ? { key: 'fa04e.req.rejectedBy', params: { name: by }, tone: 'tomato' } : { key: 'fa04e.req.rejected', tone: 'tomato' };
}
