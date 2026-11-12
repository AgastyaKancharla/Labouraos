import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { firstName, type Brief } from '../_kit/api';

/** Leave — design T-Leave.dc.html. */
interface ScheduleRow {
  id: string;
  ref: string;
  staff: Brief;
  isYou: boolean;
  kind: string;
  fromDate: string;
  toDate: string;
  days: number;
  status: string;
  where: string;
  waitingForYou: boolean;
}
interface BalanceRow {
  staff: Brief;
  plannedLeft: number;
  emergencyLeft: number;
  plannedUsedThisMonth: number;
  emergencyUsedThisMonth: number;
}
interface LeaveBoard {
  manager: Brief | null;
  summary: { offToday: number; offNext7Days: number; waitingForYou: number; pastThreePlanned: number };
  schedule: ScheduleRow[];
  balances: BalanceRow[];
}

const day = (ymd: string) => formatDateIST(`${ymd}T06:00:00Z`);

export default function TeamLeadLeave() {
  const to = useScreenPath();
  const board = useQuery({ queryKey: ['team-lead', 'leave'], queryFn: () => api.get<LeaveBoard>('/team-lead/leave') });
  const b = board.data;
  const mgr = b?.manager ? firstName(b.manager.name) : 'the Manager';
  const schedule: Column<ScheduleRow>[] = [
    { key: 'date', header: 'Date', cell: (r) => (r.fromDate === r.toDate ? day(r.fromDate) : `${day(r.fromDate)} – ${day(r.toDate)}`), sortValue: (r) => r.fromDate },
    { key: 'who', header: 'Who', cell: (r) => `${r.staff.name}${r.isYou ? ' (you)' : ''}`, filter: 'text', filterValue: (r) => r.staff.name },
    { key: 'type', header: 'Type', cell: (r) => (r.kind === 'casual' ? 'Planned' : 'Emergency'), filter: 'select', filterValue: (r) => (r.kind === 'casual' ? 'Planned' : 'Emergency') },
    { key: 'where', header: 'Where the request is', cell: (r) => (r.waitingForYou ? <Link to={to('T-Req-Sneha', { id: r.ref })}>{r.where}</Link> : r.where) },
  ];
  const balances: Column<BalanceRow>[] = [
    { key: 'name', header: 'Name', cell: (r) => r.staff.name, sortValue: (r) => r.staff.name },
    { key: 'planned', header: 'Planned left', cell: (r) => r.plannedLeft, sortValue: (r) => r.plannedLeft },
    { key: 'emergency', header: 'Emergency left', cell: (r) => r.emergencyLeft, sortValue: (r) => r.emergencyLeft },
    { key: 'pused', header: 'Planned used this month', cell: (r) => r.plannedUsedThisMonth },
    { key: 'eused', header: 'Emergency used this month', cell: (r) => r.emergencyUsedThisMonth },
  ];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Leave" subtitle="Who in your team is off, where each request is, and how much leave everyone has left." />
      <StatGrid>
        <StatTile label="Off today" value={b?.summary.offToday ?? '—'} tone="royal" loading={board.isPending} />
        <StatTile label="Off in the next 7 days" value={b?.summary.offNext7Days ?? '—'} tone="cyan" loading={board.isPending} />
        <StatTile label="Waiting for you" value={b?.summary.waitingForYou ?? '—'} tone="orange" loading={board.isPending} to={to('T-Requests')} />
        <StatTile label="Past 3 planned days" value={b?.summary.pastThreePlanned ?? '—'} tone="red" loading={board.isPending} />
      </StatGrid>
      <div className="two-col">
        <Card title="Who is off · next 2 weeks" aside={<Link to={to('T-Requests')}>Requests</Link>} flush>
          <DataTable columns={schedule} rows={b?.schedule} rowKey={(r) => r.id} caption="Who is off in the next two weeks" loading={board.isPending} error={board.error} onRetry={() => void board.refetch()} emptyTitle="Nobody is off in the next two weeks." />
          <div className="tl-note" style={{ padding: '0 18px 14px' }}>
            When you're off, {mgr} gives your team its login codes and answers its requests
          </div>
        </Card>
        <Card title="Leave left" flush>
          <DataTable columns={balances} rows={b?.balances} rowKey={(r) => r.staff.id} caption="Leave left" loading={board.isPending} error={board.error} emptyTitle="Nobody in your team yet." />
        </Card>
      </div>
      <div className="tl-note">You approve up to 3 planned days a month per person · more than 3 goes to {mgr} · 1 planned and 1 emergency day are added every month and keep adding up</div>
    </div>
  );
}
