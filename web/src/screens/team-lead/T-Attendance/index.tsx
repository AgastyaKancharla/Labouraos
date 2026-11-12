import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatTimeIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { hm } from '../../ceo/_kit/format';
import { FilterPanel, SelectFilter } from '../../ceo/_kit/kit';
import { firstName, STATUS_LABEL, statusTone, useTeam, type Brief } from '../_kit/api';
import { AttendanceTabs } from './tabs';

/** Attendance · today — design T-Attendance.dc.html. Change day goes through the requests backend (a 3rd change in a month goes to the Manager). */
interface Row {
  staff: Brief;
  dayId: string | null;
  dayType: string | null;
  loginAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakSeconds: number;
  overBreak: boolean;
  status: string | null;
  changesThisMonth: number;
}
interface Board {
  date: string;
  isToday: boolean;
  summary: { atWork: number; people: number; late: number; overBreak: number; secondsLost: number };
  rows: Row[];
}

const DAY_TYPE: Record<string, string> = { full: 'Full day', half: 'Half day', absent: 'Absent', leave: 'Leave', off: 'Day off', open: 'Still working' };

export default function TeamLeadAttendance() {
  const to = useScreenPath();
  const now = useNow();
  const team = useTeam();
  const [date, setDate] = useState(() => istDateKey(now));
  const [show, setShow] = useState('');
  const board = useQuery({ queryKey: ['team-lead', 'attendance', date], queryFn: () => api.get<Board>('/team-lead/attendance', { query: { date } }), refetchInterval: 30_000 });
  const b = board.data;
  const mgr = team.data?.manager ? firstName(team.data.manager.name) : 'the Manager';
  const rows = (b?.rows ?? []).filter((r) => !show || (show === 'late' ? r.lateMinutes > 0 : show === 'short' ? r.dayType === 'half' || r.dayType === 'absent' : r.overBreak));
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Name', cell: (r) => <Link to={to('T-Agent', { id: r.staff.id })}>{r.staff.name}</Link>, sortValue: (r) => r.staff.name },
    { key: 'role', header: 'Role', cell: (r) => (r.staff.role === 'field_agent' ? 'Field' : 'Call') },
    { key: 'login', header: 'Login', cell: (r) => (r.loginAt ? formatTimeIST(r.loginAt) : '—'), sortValue: (r) => r.loginAt ?? '' },
    { key: 'work', header: 'Work time', cell: (r) => (r.loginAt ? hm(r.productionSeconds) : '—'), sortValue: (r) => r.productionSeconds },
    { key: 'late', header: 'Late', cell: (r) => (r.loginAt ? (r.lateMinutes ? <span className="tl-alert">{r.lateMinutes} min late</span> : 'On time') : '—') },
    { key: 'breaks', header: 'Breaks', cell: (r) => (r.loginAt ? `${hm(r.breakSeconds)}${r.overBreak ? ' · over' : ''}` : '—'), hideOnPhone: true },
    {
      key: 'now',
      header: b?.isToday ? 'Right now' : 'Counts as',
      cell: (r) =>
        b?.isToday && r.status ? (
          <StatusPill tone={statusTone({ status: r.status, overBreak: r.overBreak })}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>
        ) : (
          DAY_TYPE[r.dayType ?? ''] ?? '—'
        ),
    },
    { key: 'change', header: 'Change the day (with a reason)', cell: (r) => <ChangeDay row={r} managerName={mgr} /> },
  ];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Attendance · today" subtitle="Your team's day: login, work time, late minutes, breaks and how the day counts." />
      <AttendanceTabs />
      <FilterPanel>
        <label className="field">
          Day
          <input type="date" value={date} max={istDateKey(now)} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <SelectFilter label="Show" value={show} onChange={setShow} options={[{ value: '', label: 'Everyone' }, { value: 'late', label: 'Late' }, { value: 'short', label: 'Short days' }, { value: 'over', label: 'Over break' }]} />
      </FilterPanel>
      <StatGrid>
        <StatTile label="At work" value={b ? `${b.summary.atWork} / ${b.summary.people}` : '—'} tone="good" loading={board.isPending} />
        <StatTile label="Late logins" value={b?.summary.late ?? '—'} tone="orange" loading={board.isPending} />
        <StatTile label="Over break" value={b?.summary.overBreak ?? '—'} tone="red" loading={board.isPending} />
        <StatTile label="Work time lost" value={b ? hm(b.summary.secondsLost) : '—'} tone="gold" loading={board.isPending} />
      </StatGrid>
      <Card flush>
        <DataTable columns={columns} rows={b ? rows : undefined} rowKey={(r) => r.staff.id} caption="Attendance" loading={board.isPending} error={board.error} onRetry={() => void board.refetch()} emptyTitle="No rows match these filters. Change a filter to see more." />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          Full day = 8 work hours, half day under 4.5, with the 5–10 minute allowance · a 3rd change for the same person in a month goes to {mgr}
        </div>
      </Card>
    </div>
  );
}

function ChangeDay({ row, managerName }: { row: Row; managerName: string }) {
  const [dayType, setDayType] = useState('');
  const [reason, setReason] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: () => api.post<{ status: string }>('/requests', { kind: 'day_change', dayId: row.dayId, dayType, reason }),
    onSuccess: (res) => {
      toast.success(res.status === 'approved' ? `${row.staff.name}'s day now counts as a ${dayType} day` : `3rd change this month — sent to ${managerName}`);
      setDayType('');
      setReason('');
      void qc.invalidateQueries({ queryKey: ['team-lead'] });
      void qc.invalidateQueries({ queryKey: ['requests'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not change the day'),
  });
  if (!row.dayId || !row.dayType || !['full', 'half', 'absent'].includes(row.dayType)) return <span className="tl-sub">{row.dayType === 'open' ? 'After the day ends' : '—'}</span>;
  return (
    <div className="tl-inline">
      <select aria-label={`Change ${row.staff.name}'s day`} value={dayType} onChange={(e) => setDayType(e.target.value)}>
        <option value="">Change day…</option>
        {row.dayType !== 'full' && <option value="full">Full day</option>}
        {row.dayType !== 'half' && <option value="half">Half day</option>}
      </select>
      {dayType && <input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <Button size="compact" onClick={() => change.mutate()} disabled={!dayType || !reason.trim()} loading={change.isPending}>
        Save
      </Button>
    </div>
  );
}
