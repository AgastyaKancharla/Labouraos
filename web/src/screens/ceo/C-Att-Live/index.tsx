import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatTimeIST } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { hm, liveLabel, roleLabel } from '../_kit/format';
import { AttendanceTabs } from '../_kit/tabs';

/** Attendance · live board — design C-Att-Live.dc.html. Refreshes every few seconds. */
export interface LiveRow {
  staff: { id: string; code: string; name: string; role: string };
  status: string;
  since: string | null;
  loginAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakSeconds: number;
  breakOverSeconds: number;
  overBreak: boolean;
  idle: boolean;
  idleSeconds: number;
}
export interface LiveBoard {
  asOf: string;
  counts: Record<string, number>;
  people: LiveRow[];
}

const BUSY = ['on_call', 'after_call_notes', 'on_visit', 'travelling'];
const BREAKS = ['short_break', 'lunch'];

export function rightNow(r: LiveRow, now: Date): string {
  const l = liveLabel(r.status).label;
  const mins = r.since ? Math.max(0, Math.floor((now.getTime() - new Date(r.since).getTime()) / 60000)) : null;
  if (r.status === 'on_call' && r.since) {
    const s = Math.max(0, Math.floor((now.getTime() - new Date(r.since).getTime()) / 1000));
    return `${l} · ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  if (r.overBreak) return `${l} · over break time`;
  if (r.status === 'idle') return `${l} · ${Math.round(r.idleSeconds / 60) || mins || 0} min`;
  if (r.status === 'not_logged_in') return `${l}`;
  if (r.since) return `${l} · since ${formatTimeIST(r.since)}`;
  return l;
}

export default function AttendanceLive() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const now = useNow();
  const board = useQuery({ queryKey: ['attendance', 'live'], queryFn: () => api.get<LiveBoard>('/attendance/live'), refetchInterval: 5000 });
  const people = board.data?.people;
  const count = (pred: (r: LiveRow) => boolean) => (people ? people.filter(pred).length : '—');

  const columns: Column<LiveRow>[] = [
    { key: 'staff', header: 'Staff', cell: (r) => <div><div style={{ fontWeight: 600 }}>{r.staff.name}</div><div className="ceo-cell-sub">{r.staff.code}</div></div>, filter: 'text', filterValue: (r) => `${r.staff.name} ${r.staff.code}`, sortValue: (r) => r.staff.name, csv: (r) => r.staff.name },
    { key: 'role', header: 'Role', cell: (r) => roleLabel(r.staff.role), filter: 'select', filterValue: (r) => roleLabel(r.staff.role), csv: (r) => roleLabel(r.staff.role) },
    {
      key: 'now',
      header: 'Right now',
      cell: (r) => <StatusPill tone={r.overBreak ? 'danger' : liveLabel(r.status).tone}>{rightNow(r, now)}</StatusPill>,
      filter: 'select',
      filterValue: (r) => liveLabel(r.status).label,
      csv: (r) => rightNow(r, now),
    },
    { key: 'login', header: 'Login', cell: (r) => (r.loginAt ? formatTimeIST(r.loginAt) : '—'), csv: (r) => r.loginAt, hideOnPhone: true },
    { key: 'prod', header: 'Production today', cell: (r) => hm(r.productionSeconds), sortValue: (r) => r.productionSeconds, csv: (r) => Math.round(r.productionSeconds / 60), hideOnPhone: true },
    { key: 'breaks', header: 'Breaks', cell: (r) => `${hm(r.breakSeconds)}${r.breakOverSeconds ? ` (${hm(r.breakOverSeconds)} over)` : ''}`, csv: (r) => Math.round(r.breakSeconds / 60), hideOnPhone: true },
  ];

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Team-Attendance'), label: 'Attendance' }} title="Attendance · live board" subtitle="Who is working right now, across every team." />
      <AttendanceTabs />
      <StatGrid>
        <StatTile label="Available" value={count((r) => r.status === 'available')} tone="good" loading={board.isPending} />
        <StatTile label="On calls / visits" value={count((r) => BUSY.includes(r.status))} tone="royal" loading={board.isPending} />
        <StatTile label="On break" value={count((r) => BREAKS.includes(r.status) && !r.overBreak)} tone="cyan" loading={board.isPending} />
        <StatTile label="Over break time" value={count((r) => r.overBreak)} tone="orange" loading={board.isPending} />
        <StatTile label="Idle" value={count((r) => r.status === 'idle')} tone="gold" loading={board.isPending} />
        <StatTile label="Missing" value={count((r) => r.status === 'not_logged_in')} tone="red" loading={board.isPending} />
      </StatGrid>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={people} rowKey={(r) => r.staff.id} caption="Live board" loading={board.isPending} error={board.error} onRetry={() => void board.refetch()} download="attendance-live" emptyTitle="Nobody marks attendance yet." onRowClick={(r) => navigate(to('C-Att-Person', { staffId: r.staff.id }))} />
        <div className="ceo-note">Updates every few seconds · calls stop for anyone not Available</div>
      </div>
    </div>
  );
}
