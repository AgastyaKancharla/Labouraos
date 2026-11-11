import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { PlacementTabs } from '../_kit/tabs';

/** Joining & check-ins — design C-Checkins.dc.html. */
interface Row {
  id: string;
  check: 'joining' | 'day7' | 'day30';
  due: string;
  placement: { id: string; code: string } | null;
  jobSeeker: { id: string; code: string; name: string } | null;
  business: { id: string; code: string; name: string } | null;
  result: string;
  tone: StatusTone;
  agent: { id: string; name: string } | null;
}
interface Checkins {
  rows: Row[];
  summary: { joinings: number; joined: number; checkInsDue: number; checkInsDone: number; overdue: number };
}
const CHECK: Record<Row['check'], string> = { joining: 'Joining', day7: 'Day 7', day30: 'Day 30' };

export default function CheckinsScreen() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const now = useNow();
  const [period, setPeriod] = useState<Period>(() => periodFor('week', now));
  const range = periodToUtcRange(period);
  const q = useQuery({ queryKey: ['ceo', 'check-ins', range], queryFn: () => api.get<Checkins>('/ceo/check-ins', { query: range }) });
  const s = q.data?.summary;
  const columns: Column<Row>[] = [
    { key: 'check', header: 'Check', cell: (r) => CHECK[r.check], filter: 'select', filterValue: (r) => CHECK[r.check], csv: (r) => CHECK[r.check] },
    { key: 'due', header: 'Due', cell: (r) => formatDateIST(r.due), sortValue: (r) => r.due, csv: (r) => r.due },
    { key: 'who', header: 'Who', cell: (r) => `${r.jobSeeker?.name ?? '—'} → ${r.business?.name ?? '—'}`, filter: 'text', filterValue: (r) => `${r.jobSeeker?.name ?? ''} ${r.business?.name ?? ''} ${r.placement?.code ?? ''}`, csv: (r) => `${r.jobSeeker?.name ?? ''} → ${r.business?.name ?? ''}` },
    { key: 'result', header: 'Result', cell: (r) => <StatusPill tone={r.tone}>{r.result}</StatusPill>, filter: 'select', filterValue: (r) => r.result, csv: (r) => r.result },
    { key: 'agent', header: 'Agent', cell: (r) => r.agent?.name ?? '—', csv: (r) => r.agent?.name, hideOnPhone: true },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Placements'), label: 'Placements' }} title="Joining & check-ins" subtitle="Joining confirmations and the day-7 and day-30 check-in calls." period={period} onPeriodChange={setPeriod} />
      <PlacementTabs />
      <StatGrid>
        <StatTile label="Joining due" value={s?.joinings ?? '—'} tone="navy" loading={q.isPending} />
        <StatTile label="Joined (both calls answered)" value={s?.joined ?? '—'} tone="good" loading={q.isPending} />
        <StatTile label="Check-ins due" value={s?.checkInsDue ?? '—'} tone="cyan" loading={q.isPending} />
        <StatTile label="Check-ins done" value={s?.checkInsDone ?? '—'} tone="royal" loading={q.isPending} />
        <StatTile label="Overdue" value={s?.overdue ?? '—'} tone="red" loading={q.isPending} />
      </StatGrid>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={q.data?.rows} rowKey={(r) => r.id} caption="Joining and check-ins" loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} download={`check-ins-${period.from}-${period.to}`} emptyTitle="No joinings or check-ins in this period." onRowClick={(r) => r.placement && navigate(to('C-Placement', { id: r.placement.id }))} />
        <div className="ceo-note">Joining is recorded only when calls to both the worker and the owner are answered · day-7 and day-30 check-ins catch people about to leave and businesses that hired quietly</div>
      </div>
    </div>
  );
}
