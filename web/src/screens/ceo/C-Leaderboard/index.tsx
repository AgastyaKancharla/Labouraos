import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { periodFor, periodRangeLabel, periodToUtcRange, type Period } from '../../../lib/period';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { TargetTabs } from '../_kit/tabs';
import { useTargetsBoard, type TargetRow } from '../_kit/targets';

/** Leaderboard — design C-Leaderboard.dc.html. Ranked on results that make money, never on calls dialled. */
export default function Leaderboard() {
  const to = useScreenPath();
  const now = useNow();
  // Today / This week / This month / Custom (design C-Leaderboard). This month keeps the targets and progress;
  // the other periods count the same results inside the range (targets are monthly).
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const month = period.from.slice(0, 7);
  const monthly = period.preset === 'month';
  const board = useTargetsBoard(month);
  const ranged = useQuery({
    queryKey: ['ceo', 'leaderboard', period.from, period.to],
    queryFn: () => api.get<{ leaderboard: TargetRow[] }>('/ceo/leaderboard', { query: periodToUtcRange(period) }),
    enabled: !monthly,
  });
  const source = monthly ? board : ranged;
  const call = (r: TargetRow) => r.staff.role === 'call_agent';
  const columns: Column<TargetRow>[] = [
    { key: 'pos', header: '#', cell: (r) => <strong>{r.position}</strong>, sortValue: (r) => r.position ?? 0, csv: (r) => r.position },
    { key: 'agent', header: 'Agent', cell: (r) => <strong>{r.staff.name}</strong>, filter: 'text', filterValue: (r) => r.staff.name, csv: (r) => r.staff.name },
    { key: 'team', header: 'Team', cell: (r) => `${call(r) ? 'Call' : 'Field'}${r.team ? ` · ${r.team}` : ''}`, filter: 'select', filterValue: (r) => (call(r) ? 'Call' : 'Field'), csv: (r) => `${call(r) ? 'Call' : 'Field'} ${r.team ?? ''}` },
    { key: 'main', header: 'Main result', cell: (r) => `${r.main.achieved} ${call(r) ? 'activated' : 'placements'}`, sortValue: (r) => r.main.achieved, csv: (r) => r.main.achieved },
    { key: 'second', header: 'Second', cell: (r) => (call(r) ? `${r.second.achieved} vacancies` : `${formatINR(r.feesPaise ?? 0)} fees`), csv: (r) => (call(r) ? r.second.achieved : (r.feesPaise ?? 0) / 100), hideOnPhone: true },
    {
      key: 'progress',
      header: 'Progress',
      cell: (r) => (r.progressPercent === null ? <span className="ceo-sub">{monthly ? 'No target' : 'Targets are monthly'}</span> : r.pace === 'behind' ? <StatusPill tone="warn">{`${r.progressPercent}% · behind`}</StatusPill> : `${r.progressPercent}% of target`),
      sortValue: (r) => r.progressPercent ?? -1,
      csv: (r) => r.progressPercent,
    },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Team-Targets'), label: 'Targets' }} title="Leaderboard" subtitle={`Who is delivering, across every team · ${periodRangeLabel(period)}`} period={period} onPeriodChange={setPeriod} />
      <TargetTabs />
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={source.data?.leaderboard} rowKey={(r) => r.staff.id} caption={`Leaderboard ${period.from} to ${period.to}`} loading={source.isPending} error={source.error} onRetry={() => void source.refetch()} download={`leaderboard-${period.from}-${period.to}`} emptyTitle="No agents yet." />
        <div className="ceo-note">Ranked on results that make money — placements and activations — never on calls dialled</div>
      </div>
    </div>
  );
}
