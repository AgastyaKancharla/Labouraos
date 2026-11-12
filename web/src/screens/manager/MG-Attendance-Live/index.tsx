import { useQuery } from '@tanstack/react-query';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { liveLabel } from '../../ceo/_kit/format';
import { rightNow, type LiveBoard, type LiveRow } from '../../ceo/C-Att-Live';
import { roleTeam, teamShort } from '../_kit/kit';
import { AttendanceTabs } from '../_kit/tabs';

const BUSY = ['on_call', 'after_call_notes', 'on_visit', 'travelling'];
const BREAKS = ['short_break', 'lunch'];

interface StaffList {
  rows: { id: string; team: string | null; isIntern: boolean }[];
}

/**
 * Attendance · live board — design MG-Attendance-Live.dc.html, on
 * GET /attendance/live (already the Manager's own tree) with team names from
 * GET /manager/staff. Updates every few seconds.
 */
export default function ManagerAttendanceLive() {
  const to = useScreenPath();
  const now = useNow();
  const board = useQuery({ queryKey: ['attendance', 'live'], queryFn: () => api.get<LiveBoard>('/attendance/live'), refetchInterval: 5000 });
  const staff = useQuery({ queryKey: ['manager', 'staff'], queryFn: () => api.get<StaffList>('/manager/staff') });
  const teamOf = new Map((staff.data?.rows ?? []).map((r) => [r.id, r]));
  const people = board.data?.people;
  const count = (pred: (r: LiveRow) => boolean) => (people ? people.filter(pred).length : '—');

  const columns: Column<LiveRow>[] = [
    { key: 'staff', header: 'Staff', cell: (r) => <b>{r.staff.name}</b>, filter: 'text', filterValue: (r) => `${r.staff.name} ${r.staff.code}`, sortValue: (r) => r.staff.name, csv: (r) => r.staff.name },
    {
      key: 'team',
      header: 'Team',
      cell: (r) => roleTeam(r.staff.role, teamOf.get(r.staff.id)?.team, teamOf.get(r.staff.id)?.isIntern),
      filter: 'select',
      filterValue: (r) => teamShort(teamOf.get(r.staff.id)?.team),
      csv: (r) => teamOf.get(r.staff.id)?.team ?? '',
    },
    {
      key: 'now',
      header: 'Right now',
      cell: (r) => <StatusPill tone={r.overBreak ? 'danger' : liveLabel(r.status).tone}>{rightNow(r, now)}</StatusPill>,
      filter: 'select',
      filterValue: (r) => liveLabel(r.status).label,
      csv: (r) => rightNow(r, now),
    },
  ];

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Attendance'), label: 'Attendance' }} title="Attendance · live board" subtitle="Who is working right now in your teams." />
      <AttendanceTabs />
      <StatGrid>
        <StatTile label="Available" value={count((r) => r.status === 'available')} tone="good" loading={board.isPending} />
        <StatTile label="On calls / visits" value={count((r) => BUSY.includes(r.status))} tone="royal" loading={board.isPending} />
        <StatTile label="On break" value={count((r) => BREAKS.includes(r.status) && !r.overBreak)} tone="cyan" loading={board.isPending} />
        <StatTile label="Over break" value={count((r) => r.overBreak)} tone="orange" loading={board.isPending} />
        <StatTile label="Idle" value={count((r) => r.status === 'idle')} tone="gold" loading={board.isPending} />
        <StatTile label="Missing" value={count((r) => r.status === 'not_logged_in')} tone="red" loading={board.isPending} />
      </StatGrid>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={people} rowKey={(r) => r.staff.id} caption="Live board" loading={board.isPending} error={board.error} onRetry={() => void board.refetch()} download="attendance-live" emptyTitle="Nobody in your teams marks attendance yet." />
        <div className="ceo-note">Updates every few seconds · calls stop for anyone not Available</div>
      </div>
    </div>
  );
}
