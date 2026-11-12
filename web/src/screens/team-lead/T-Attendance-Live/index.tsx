import { useMutation } from '@tanstack/react-query';
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
import { formatTimeIST } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { liveText, statusTone, useLive, type LiveRow } from '../_kit/api';
import { AttendanceTabs } from '../T-Attendance/tabs';

/** Attendance · live board — design T-Attendance-Live.dc.html. */
const ON_WORK = ['on_call', 'after_call_notes', 'on_visit'];

export default function TeamLeadLive() {
  const to = useScreenPath();
  const now = useNow();
  const live = useLive();
  const people = live.data?.people ?? [];
  const columns: Column<LiveRow>[] = [
    { key: 'agent', header: 'Agent', cell: (r) => <Link to={to('T-Agent', { id: r.staff.id })}>{r.staff.name}</Link>, sortValue: (r) => r.staff.name },
    { key: 'role', header: 'Role', cell: (r) => (r.staff.role === 'field_agent' ? 'Field' : 'Call') },
    {
      key: 'now',
      header: 'Right now',
      cell: (r) => (
        <StatusPill tone={statusTone(r)}>
          {liveText(r, now)}
          {r.status === 'available' && r.since ? ` · since ${formatTimeIST(r.since)}` : ''}
        </StatusPill>
      ),
    },
    { key: 'act', header: '', cell: (r) => (r.overBreak || r.idle ? <Remind row={r} /> : <span className="tl-sub">—</span>) },
  ];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Attendance'), label: 'Attendance' }} title="Attendance · live board" subtitle="Who in your team is working right now." />
      <AttendanceTabs />
      <StatGrid>
        <StatTile label="Available" value={live.data ? people.filter((p) => p.status === 'available').length : '—'} tone="good" loading={live.isPending} />
        <StatTile label="On a call or visit" value={live.data ? people.filter((p) => ON_WORK.includes(p.status)).length : '—'} tone="royal" loading={live.isPending} />
        <StatTile label="Over break" value={live.data ? people.filter((p) => p.overBreak).length : '—'} tone="red" loading={live.isPending} />
        <StatTile label="Travelling" value={live.data ? people.filter((p) => p.status === 'travelling').length : '—'} tone="cyan" loading={live.isPending} />
      </StatGrid>
      <Card flush>
        <DataTable columns={columns} rows={live.data ? people : undefined} rowKey={(r) => r.staff.id} caption="Live board" loading={live.isPending} error={live.error} onRetry={() => void live.refetch()} emptyTitle="Nobody in your team yet." />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          Updates every few seconds · calls only go to agents who are Available
        </div>
      </Card>
    </div>
  );
}

function Remind({ row }: { row: LiveRow }) {
  const toast = useToast();
  const remind = useMutation({
    mutationFn: () => api.post('/team-lead/remind', { staffId: row.staff.id, text: row.overBreak ? 'Your break is over — please come back' : 'You have been idle — pick a status' }),
    onSuccess: () => toast.success(`Reminded ${row.staff.name}`),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not send the reminder'),
  });
  return (
    <Button size="compact" onClick={() => remind.mutate()} loading={remind.isPending}>
      Remind
    </Button>
  );
}
