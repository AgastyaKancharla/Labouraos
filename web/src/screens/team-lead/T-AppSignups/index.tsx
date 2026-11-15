import '../_kit/tl.css';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import {
  type AreaTask,
  type Brief,
  type Funnel,
  FunnelTable,
  KIND_LABEL,
  NextCell,
  PersonCell,
  REASON_LABEL,
  type SignupRow,
  StageCell,
} from '../../shared/appSignups';

interface TeamLeadSignups {
  now: string;
  team: Array<Brief & { spokenLanguages: string[] }>;
  summary: { open: number; overdue: number; unassigned: number; finished: number; finishedWithoutHelpPercent: number | null };
  funnel: Funnel;
  rows: SignupRow[];
  unassigned: SignupRow[];
  reengage: SignupRow[];
  seekerVisitRequests: Array<SignupRow & { askedAt: string; note: string | null }>;
  areaTasks: AreaTask[];
}

const KEY = ['signup-tracker', 'team-lead'];

/**
 * T-AppSignups — the team's unfinished app sign-ups (customer app proposal
 * 4.4): the funnel, every open sign-up with its stage, what is missing, the
 * agent and the next call; overdue and unassigned ones; move a sign-up to
 * another call agent in the team (POST /signup-tracker/:id/reassign); job
 * seekers who asked for a visit, areas with several stuck sign-ups, and the
 * monthly re-engagement list. Own team only (the API enforces it).
 */
export default function TeamLeadAppSignups() {
  const to = useScreenPath();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<TeamLeadSignups>('/signup-tracker/team-lead') });
  const d = q.data;
  const team = d?.team ?? [];

  const columns: Column<SignupRow>[] = [
    { key: 'person', header: 'Person', cell: (r) => <PersonCell row={r} />, filter: 'text', filterValue: (r) => `${r.name} ${r.code ?? ''}` },
    { key: 'kind', header: 'Kind', cell: (r) => KIND_LABEL[r.kind] ?? r.kind, filter: 'select', filterValue: (r) => KIND_LABEL[r.kind] ?? r.kind },
    { key: 'stage', header: 'Stage', cell: (r) => <StageCell row={r} />, sortValue: (r) => r.stage },
    { key: 'why', header: 'Why stuck', cell: (r) => r.stuckReason ?? '—', hideOnPhone: true },
    {
      key: 'agent',
      header: 'Agent',
      cell: (r) => (r.assignedTo ? <span>{r.assignedTo.name}<span className="sub" style={{ display: 'block' }}>{REASON_LABEL[r.assignmentReason ?? ''] ?? ''}</span></span> : 'Nobody yet'),
      filter: 'select',
      filterValue: (r) => r.assignedTo?.name ?? 'Nobody yet',
    },
    { key: 'tries', header: 'Calls', cell: (r) => `${r.callTries} of 3`, sortValue: (r) => r.callTries, align: 'right', hideOnPhone: true },
    { key: 'next', header: 'Next', cell: (r) => <NextCell row={r} />, sortValue: (r) => r.openTask?.dueAt ?? r.nextActionAt ?? '' },
    { key: 'move', header: '', cell: (r) => <Move row={r} team={team} /> },
  ];
  const visitColumns: Column<SignupRow & { askedAt: string; note: string | null }>[] = [
    { key: 'person', header: 'Job seeker', cell: (r) => <PersonCell row={r} /> },
    { key: 'asked', header: 'Asked', cell: (r) => formatDateTimeIST(r.askedAt) },
    { key: 'note', header: 'What they said', cell: (r) => r.note ?? '—' },
    { key: 'agent', header: 'Agent', cell: (r) => r.assignedTo?.name ?? 'Nobody yet' },
  ];
  const areaColumns: Column<AreaTask>[] = [
    { key: 'area', header: 'Area', cell: (a) => a.area },
    { key: 'count', header: 'Stuck sign-ups', cell: (a) => a.count, align: 'right', sortValue: (a) => a.count },
    { key: 'note', header: '', cell: () => 'Send one field agent to help them all' },
  ];
  const closedColumns: Column<SignupRow>[] = [
    { key: 'person', header: 'Person', cell: (r) => <PersonCell row={r} /> },
    { key: 'kind', header: 'Kind', cell: (r) => KIND_LABEL[r.kind] ?? r.kind },
    { key: 'stage', header: 'Stopped at', cell: (r) => <StageCell row={{ ...r, outcome: 'open' }} /> },
    { key: 'outcome', header: 'Closed as', cell: (r) => (r.outcome === 'no_response' ? 'No answer after 3 tries' : 'Said not now') },
    { key: 'next', header: 'Next reminder', cell: (r) => (r.nextActionAt ? formatDateTimeIST(r.nextActionAt) : '—') },
  ];

  return (
    <div className="lb-page">
      <TopBar
        showSearch={false}
        back={{ to: to('T-Home'), label: 'My team' }}
        title="App sign-ups"
        subtitle="People who started signing up in the Laboura app and stopped. The software gives each one to an agent; move one when it suits better."
      />
      <StatGrid>
        <StatTile label="Open sign-ups" value={d?.summary.open ?? '—'} tone="royal" loading={q.isPending} />
        <StatTile label="Calls overdue" value={d?.summary.overdue ?? '—'} tone="red" loading={q.isPending} />
        <StatTile label="Nobody on it yet" value={d?.summary.unassigned ?? '—'} tone="orange" loading={q.isPending} />
        <StatTile
          label="Finished (30 days)"
          value={d?.summary.finished ?? '—'}
          detail={d?.summary.finishedWithoutHelpPercent === null || !d ? undefined : `${d.summary.finishedWithoutHelpPercent}% without help`}
          tone="good"
          loading={q.isPending}
        />
      </StatGrid>
      <Card title="Where your team's sign-ups stand">
        <FunnelTable
          funnel={d?.funnel}
          caption="Open sign-ups by stage"
          note="A phone verified · B form filled · C consent / agreement / terms · D selfie and ID / visit booked · E payment pending / visit done / UPI added"
        />
      </Card>
      <Card title="Your team's sign-ups" flush>
        <DataTable
          columns={columns}
          rows={d?.rows}
          rowKey={(r) => r.id}
          caption="Your team's app sign-ups"
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          emptyTitle="No open app sign-ups in your team."
        />
      </Card>
      <Card title="Nobody on it yet" flush>
        <DataTable
          columns={columns}
          rows={d?.unassigned}
          rowKey={(r) => r.id}
          caption="App sign-ups with no agent"
          loading={q.isPending}
          emptyTitle="Every sign-up has an agent."
        />
      </Card>
      <Card title="Job seekers who asked for a visit" flush>
        <DataTable columns={visitColumns} rows={d?.seekerVisitRequests} rowKey={(r) => r.id} caption="Visit requests from job seekers" loading={q.isPending} emptyTitle="Nobody asked for a visit." />
      </Card>
      <Card title="Areas with several stuck sign-ups" flush>
        <DataTable columns={areaColumns} rows={d?.areaTasks} rowKey={(a) => a.area} caption="Areas with stuck sign-ups" loading={q.isPending} emptyTitle="No area has several stuck sign-ups." />
      </Card>
      <Card title="Monthly re-engagement list" flush>
        <DataTable columns={closedColumns} rows={d?.reengage} rowKey={(r) => r.id} caption="Closed sign-ups to try again monthly" loading={q.isPending} emptyTitle="Nothing on the list." />
      </Card>
    </div>
  );
}

function Move({ row, team }: { row: SignupRow; team: Brief[] }) {
  const [agent, setAgent] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: () => api.post(`/signup-tracker/${row.id}/reassign`, { staffId: agent }),
    onSuccess: () => {
      toast.success('Sign-up moved');
      setAgent('');
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not move the sign-up'),
  });
  const choices = team.filter((m) => m.id !== row.assignedTo?.id);
  if (row.outcome !== 'open' || choices.length === 0) return null;
  return (
    <div className="tl-inline">
      <select aria-label={`Move ${row.name} to`} value={agent} onChange={(e) => setAgent(e.target.value)}>
        <option value="">{row.assignedTo ? 'Move to…' : 'Give to…'}</option>
        {choices.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <Button size="compact" variant="primary" onClick={() => move.mutate()} disabled={!agent} loading={move.isPending}>
        {row.assignedTo ? 'Move' : 'Give'}
      </Button>
    </div>
  );
}
