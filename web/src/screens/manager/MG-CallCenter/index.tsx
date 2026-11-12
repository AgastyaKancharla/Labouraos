import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { Tabs } from '../../../components/Tabs';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST } from '../../../lib/format/date';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { hm, liveLabel } from '../../ceo/_kit/format';
import { teamShort } from '../_kit/kit';

interface Row {
  staff: { id: string; code: string; name: string; role: string; isIntern: boolean };
  team: string | null;
  now: { status: string; since: string | null; overBreak: boolean; idleSeconds: number } | null;
  calls: number;
  answered: number;
  connectPercent: number;
  talkSeconds: number;
  registered: number;
  paid: number;
  followUpsOverdue: number;
}
interface CallCenterResponse {
  summary: { onCallsNow: number; calls: number; connectPercent: number; registrations: number; followUpsOverdue: number; missedIncoming: number };
  rows: Row[];
  overdueFollowUps: { key: string; label: string; overdue: number }[];
  missed: { id: string; at: string; callerName: string | null; phone: string; status: string; assignedTo: { id: string; name: string } | null }[];
}

function nowText(r: Row): string {
  if (!r.now) return 'Not logged in';
  if (r.now.status === 'not_logged_in') return 'Missing';
  if (r.now.overBreak) return `${liveLabel(r.now.status).label} · over`;
  if (r.now.status === 'idle') return `Idle · ${Math.round(r.now.idleSeconds / 60)} min`;
  return liveLabel(r.now.status).label;
}

/**
 * Call center · today — design MG-CallCenter.dc.html, on GET /manager/call-center:
 * every call agent in the Manager's teams, live. Counts come from the calling
 * company, never typed by agents. Tabs: Live board · Overdue follow-ups.
 */
export default function ManagerCallCenter() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const now = useNow();
  const [period, setPeriod] = useState<Period>(() => periodFor('today', now));
  const [tab, setTab] = useState<'live' | 'overdue'>('live');
  const range = periodToUtcRange(period);
  const q = useQuery({ queryKey: ['manager', 'call-center', range], queryFn: () => api.get<CallCenterResponse>('/manager/call-center', { query: range }), refetchInterval: 15_000 });
  const d = q.data;
  const s = d?.summary;

  const columns: Column<Row>[] = [
    { key: 'agent', header: 'Agent', cell: (r) => <b>{r.staff.name}{r.staff.isIntern ? ' (intern)' : ''}</b>, filter: 'text', filterValue: (r) => `${r.staff.name} ${r.staff.code}`, sortValue: (r) => r.staff.name, csv: (r) => r.staff.name },
    { key: 'team', header: 'Team', cell: (r) => teamShort(r.team), filter: 'select', filterValue: (r) => teamShort(r.team), csv: (r) => r.team },
    { key: 'calls', header: 'Calls', cell: (r) => r.calls, sortValue: (r) => r.calls, csv: (r) => r.calls },
    { key: 'conn', header: 'Connected', cell: (r) => r.answered, sortValue: (r) => r.answered, csv: (r) => r.answered },
    { key: 'talk', header: 'Talk time', cell: (r) => hm(r.talkSeconds), sortValue: (r) => r.talkSeconds, csv: (r) => Math.round(r.talkSeconds / 60), hideOnPhone: true },
    { key: 'reg', header: 'Registrations', cell: (r) => r.registered, sortValue: (r) => r.registered, csv: (r) => r.registered },
    { key: 'paid', header: 'Paid', cell: (r) => r.paid, sortValue: (r) => r.paid, csv: (r) => r.paid, hideOnPhone: true },
    { key: 'now', header: 'Right now', cell: (r) => <StatusPill tone={r.now?.overBreak ? 'danger' : r.now ? liveLabel(r.now.status).tone : 'danger'}>{nowText(r)}</StatusPill>, filter: 'select', filterValue: nowText, csv: nowText },
  ];

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Call center · today" subtitle="Every call agent's work today, live." period={period} onPeriodChange={setPeriod} />
      <StatGrid>
        <StatTile label="On calls now" value={s?.onCallsNow ?? '—'} tone="royal" loading={q.isPending} />
        <StatTile label="Calls" value={s?.calls ?? '—'} tone="navy" loading={q.isPending} />
        <StatTile label="Connected" value={s ? `${s.connectPercent}%` : '—'} tone="good" loading={q.isPending} />
        <StatTile label="Registrations" value={s?.registrations ?? '—'} tone="cyan" loading={q.isPending} />
        <StatTile label="Follow-ups overdue" value={s?.followUpsOverdue ?? '—'} tone="gold" loading={q.isPending} />
        <StatTile label="Missed incoming calls" value={s?.missedIncoming ?? '—'} tone="red" loading={q.isPending} />
      </StatGrid>
      <Tabs
        label="Call center"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'live', label: 'Live board' },
          { key: 'overdue', label: 'Overdue follow-ups' },
        ]}
      />
      {tab === 'live' ? (
        <div className="panel" style={{ padding: '6px 18px 14px' }}>
          <DataTable columns={columns} rows={d?.rows} rowKey={(r) => r.staff.id} caption="Call agents" loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} download="call-center" emptyTitle="No call agents in your teams yet." onRowClick={(r) => navigate(to('MG-Agent', { id: r.staff.id }))} />
          <div className="ceo-note">Counts come from the calling company, never typed by agents · recordings open from each call in the agent's history</div>
        </div>
      ) : (
        <div className="two-col">
          <Card title="Overdue follow-ups">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>Follow-up</th>
                    <th>Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {d?.overdueFollowUps.map((f) => (
                    <tr key={f.key}>
                      <td>{f.label}</td>
                      <td>{f.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mg-note">Per agent: {d?.rows.filter((r) => r.followUpsOverdue).map((r) => `${r.staff.name} ${r.followUpsOverdue}`).join(' · ') || 'nobody has overdue follow-ups'}</div>
          </Card>
          <Card title="Missed incoming calls">
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Caller</th>
                    <th>With</th>
                  </tr>
                </thead>
                <tbody>
                  {d?.missed.map((m) => (
                    <tr key={m.id}>
                      <td>{formatDateTimeIST(m.at)}</td>
                      <td>{m.callerName ?? m.phone}</td>
                      <td>{m.assignedTo?.name ?? 'Not assigned'}</td>
                    </tr>
                  ))}
                  {d && !d.missed.length && (
                    <tr>
                      <td colSpan={3}>No missed calls waiting.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
