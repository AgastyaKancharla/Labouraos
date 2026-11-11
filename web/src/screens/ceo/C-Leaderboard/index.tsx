import { useState } from 'react';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { istDateKey } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { MonthPicker } from '../_kit/month';
import { TargetTabs } from '../_kit/tabs';
import { useTargetsBoard, type TargetRow } from '../_kit/targets';

/** Leaderboard — design C-Leaderboard.dc.html. Ranked on results that make money, never on calls dialled. */
export default function Leaderboard() {
  const to = useScreenPath();
  const [month, setMonth] = useState(istDateKey(useNow()).slice(0, 7));
  const board = useTargetsBoard(month);
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
      cell: (r) => (r.progressPercent === null ? <span className="ceo-sub">No target</span> : r.pace === 'behind' ? <StatusPill tone="warn">{`${r.progressPercent}% · behind`}</StatusPill> : `${r.progressPercent}% of target`),
      sortValue: (r) => r.progressPercent ?? -1,
      csv: (r) => r.progressPercent,
    },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Team-Targets'), label: 'Targets' }} title="Leaderboard" subtitle="Who is delivering this month, across every team." actions={<MonthPicker value={month} onChange={setMonth} />} />
      <TargetTabs />
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={board.data?.leaderboard} rowKey={(r) => r.staff.id} caption={`Leaderboard ${month}`} loading={board.isPending} error={board.error} onRetry={() => void board.refetch()} download={`leaderboard-${month}`} emptyTitle="No agents yet." />
        <div className="ceo-note">Ranked on results that make money — placements and activations — never on calls dialled</div>
      </div>
    </div>
  );
}
