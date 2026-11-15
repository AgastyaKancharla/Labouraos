import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { ErrorState } from '../../../components/ErrorState';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import {
  type AreaTask,
  FunnelTable,
  KIND_LABEL,
  NextCell,
  OUTCOME_LABEL,
  PersonCell,
  SIGNUP_KINDS,
  SOURCE_LABEL,
  STAGES,
  type SignupCounts,
  type SignupRow,
  StageCell,
  minutesText,
} from '../../shared/appSignups';

interface CeoSignups extends SignupCounts {
  byArea: Array<{ area: string; started: number; finished: number }>;
  areaTasks: AreaTask[];
  seekerVisitRequests: Array<SignupRow & { askedAt: string }>;
  rows: SignupRow[];
  settings: {
    firstReminderMinutes: number;
    secondReminderMinutes: number;
    businessCallMinutes: number;
    paymentStopWorkingMinutes: number;
    maxCallTries: number;
    callTryDays: number;
    reengageDays: number;
    areaClusterMin: number;
    callingHoursStart: string;
    callingHoursEnd: string;
    workdayStart: string;
    workdayEnd: string;
    notYetInSettings: string[];
  };
}

const RANGES = [7, 30, 90] as const;

/**
 * C-AppSignups — every app sign-up (customer app proposal 4.4): funnels by
 * stage and kind, by area and by source, the list (filter by kind, stage and
 * outcome), job seekers who asked for a visit, areas with several stuck
 * sign-ups, and the timing rules in force.
 */
export default function CeoAppSignups() {
  const to = useScreenPath();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [kind, setKind] = useState('');
  const [stage, setStage] = useState('');
  const [outcome, setOutcome] = useState('');
  const params = new URLSearchParams({ days: String(days), ...(kind ? { kind } : {}), ...(stage ? { stage } : {}), ...(outcome ? { outcome } : {}) });
  const q = useQuery({
    queryKey: ['signup-tracker', 'ceo', days, kind, stage, outcome],
    queryFn: () => api.get<CeoSignups>(`/signup-tracker/ceo?${params.toString()}`),
  });
  const d = q.data;

  const columns: Column<SignupRow>[] = [
    { key: 'person', header: 'Person', cell: (r) => <PersonCell row={r} />, filter: 'text', filterValue: (r) => `${r.name} ${r.code ?? ''}`, csv: (r) => r.code ?? r.name },
    { key: 'kind', header: 'Kind', cell: (r) => KIND_LABEL[r.kind] ?? r.kind, csv: (r) => r.kind },
    { key: 'stage', header: 'Stage', cell: (r) => <StageCell row={r} />, sortValue: (r) => r.stage, csv: (r) => r.stage },
    { key: 'source', header: 'Came from', cell: (r) => SOURCE_LABEL[r.source ?? 'unknown'] ?? r.source, hideOnPhone: true, csv: (r) => r.source },
    { key: 'agent', header: 'Agent', cell: (r) => r.assignedTo?.name ?? '—', csv: (r) => r.assignedTo?.code ?? '' },
    { key: 'started', header: 'Started', cell: (r) => formatDateIST(r.startedAt), sortValue: (r) => r.startedAt, csv: (r) => r.startedAt },
    { key: 'next', header: 'Next', cell: (r) => (r.outcome === 'open' ? <NextCell row={r} /> : OUTCOME_LABEL[r.outcome] ?? r.outcome), hideOnPhone: true },
  ];
  const areaColumns: Column<{ area: string; started: number; finished: number }>[] = [
    { key: 'area', header: 'Area', cell: (a) => a.area },
    { key: 'started', header: 'Started', cell: (a) => a.started, align: 'right', sortValue: (a) => a.started },
    { key: 'finished', header: 'Finished', cell: (a) => a.finished, align: 'right', sortValue: (a) => a.finished },
  ];
  const clusterColumns: Column<AreaTask>[] = [
    { key: 'area', header: 'Area', cell: (a) => a.area },
    { key: 'count', header: 'Stuck job seekers', cell: (a) => a.count, align: 'right' },
  ];
  const s = d?.settings;

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="App sign-ups"
        subtitle="Everyone who started signing up in the Laboura app: where they stopped, who is helping, and how many finish."
        actions={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r} type="button" className={`tag ${days === r ? 'tb' : 'tn'}`} aria-pressed={days === r} onClick={() => setDays(r)}>
                Last {r} days
              </button>
            ))}
          </div>
        }
      />
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      <StatGrid>
        <StatTile label="Started in the app" value={d?.started ?? '—'} tone="royal" loading={q.isPending} />
        <StatTile label="Finished" value={d?.finished ?? '—'} tone="good" loading={q.isPending} />
        <StatTile
          label="Finished without help"
          value={d ? (d.finishedWithoutHelpPercent === null ? '—' : `${d.finishedWithoutHelpPercent}%`) : '—'}
          tone="cyan"
          loading={q.isPending}
        />
        <StatTile label="Typical time to finish" value={d ? minutesText(d.medianMinutesToFinish) : '—'} tone="navy" loading={q.isPending} />
      </StatGrid>
      <div className="two-col">
        <Card title="Open sign-ups by stage">
          <FunnelTable funnel={d?.openByStage} caption="Open sign-ups by stage" />
        </Card>
        <Card title="How far everyone got">
          <FunnelTable funnel={d?.reachedStage} caption="Reached each stage" note="Everyone who reached that stage or went further." />
        </Card>
      </div>
      <div className="two-col">
        <Card title="By area" flush>
          <DataTable columns={areaColumns} rows={d?.byArea} rowKey={(a) => a.area} caption="Sign-ups by area" loading={q.isPending} emptyTitle="No sign-ups yet." />
        </Card>
        <Card title="Areas with several stuck job seekers" flush>
          <DataTable columns={clusterColumns} rows={d?.areaTasks} rowKey={(a) => a.area} caption="Areas with stuck sign-ups" loading={q.isPending} emptyTitle="None right now." />
        </Card>
      </div>
      <Card
        title="All sign-ups"
        flush
        aside={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Every kind</option>
              {SIGNUP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">Every stage</option>
              {STAGES.map((st) => (
                <option key={st} value={st}>
                  {st === 'done' ? 'Done' : `Stage ${st}`}
                </option>
              ))}
            </select>
            <select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">Every outcome</option>
              {Object.entries(OUTCOME_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={d?.rows}
          rowKey={(r) => r.id}
          caption="All app sign-ups"
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          emptyTitle="No app sign-ups match."
          download="app-signups"
        />
      </Card>
      <Card title="Timing rules in force">
        {s ? (
          <div className="kv" style={{ padding: '0 18px 12px' }}>
            <span>Reminders</span>
            <span>{s.firstReminderMinutes} minutes and {minutesText(s.secondReminderMinutes)} after they stop</span>
            <span>Job seeker or partner call</span>
            <span>Next working morning; {minutesText(s.paymentStopWorkingMinutes)} of working time if stopped at payment</span>
            <span>Business call</span>
            <span>{minutesText(s.businessCallMinutes)} after they stop, plus a visit request</span>
            <span>Tries</span>
            <span>{s.maxCallTries} calls over {s.callTryDays} working days, then the re-engagement list every {s.reengageDays} days</span>
            <span>Calls only</span>
            <span>
              {s.callingHoursStart}–{s.callingHoursEnd} on working days, while agents are on shift ({s.workdayStart}–{s.workdayEnd}); never on Sundays or holidays
            </span>
            <span>Area task</span>
            <span>{s.areaClusterMin} or more stuck job seekers in one area</span>
          </div>
        ) : null}
        {s && s.notYetInSettings.length > 0 ? (
          <p className="sub" style={{ padding: '0 18px 12px' }}>
            These are the confirmed defaults. They become editable in Settings once the Settings fields are added.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
