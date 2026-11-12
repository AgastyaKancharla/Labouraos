import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useScreenPath } from '../../../portals/PortalContext';
import { Link } from 'react-router-dom';
import { firstName, useTargets, useTeam, type TeamTargets } from '../_kit/api';
import { TeamTargetsTable, Verdict } from '../_kit/targets';

/** Targets — design T-Targets.dc.html. */
type AgentRow = TeamTargets['agents'][number];

export default function TeamLeadTargets() {
  const to = useScreenPath();
  const team = useTeam();
  const targets = useTargets();
  const t = targets.data;
  const columns: Column<AgentRow>[] = [
    { key: 'agent', header: 'Agent', cell: (r) => <Link to={to('T-Agent', { id: r.staff.id })}>{r.staff.name}</Link>, sortValue: (r) => r.staff.name },
    { key: 'role', header: 'Role', cell: (r) => (r.staff.role === 'field_agent' ? 'Field' : 'Call'), filter: 'select', filterValue: (r) => (r.staff.role === 'field_agent' ? 'Field' : 'Call') },
    { key: 'main', header: 'Main target', cell: (r) => r.mainLabel },
    { key: 'target', header: 'Target', cell: (r) => r.target ?? '—' },
    { key: 'done', header: 'Done', cell: (r) => <b>{r.done}</b>, sortValue: (r) => r.done },
    { key: 'still', header: 'Still to do', cell: (r) => r.stillToDo ?? '—' },
    { key: 'speed', header: 'At this speed', cell: (r) => (r.target === null ? r.projection : `${r.projection} of ${r.target}`) },
    { key: 'make', header: 'Will they make it?', cell: (r) => <Verdict row={r} /> },
  ];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Targets" subtitle="The team's month targets and where each agent will end at today's speed." />
      <Card title={team.data?.teamName ?? 'Your team'}>
        {targets.error ? <ErrorState error={targets.error} onRetry={() => void targets.refetch()} /> : t ? <TeamTargetsTable rows={t.team} month={t.month} daysInMonth={t.daysInMonth} /> : <SkeletonCard />}
      </Card>
      <Card title="Each agent · main target" flush>
        <DataTable columns={columns} rows={t?.agents} rowKey={(r) => r.staff.id} caption="Each agent's main target" loading={targets.isPending} error={targets.error} emptyTitle="Nobody in your team yet." />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          Targets are set by {team.data?.manager ? `${firstName(team.data.manager.name)} (Manager)` : 'the Manager'} · ask them to change one from the agent's page
        </div>
      </Card>
    </div>
  );
}
