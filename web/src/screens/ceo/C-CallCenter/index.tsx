import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateTimeIST, formatTimeIST, istDateKey } from '../../../lib/format/date';
import { maskMobile } from '../../../lib/format/phone';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { hm, initials, liveLabel, ms } from '../_kit/format';
import { humanize } from '../_kit/kit';
import { rightNow } from '../C-Att-Live';

/** Call center — design C-CallCenter.dc.html. Calls are counted by the calling system, never typed. */
interface AgentRow {
  staff: { id: string; code: string; name: string; team: string | null };
  now: { status: string; since: string | null; overBreak: boolean; idleSeconds: number } | null;
  calls: number;
  answered: number;
  connectPercent: number;
  talkSeconds: number;
  registered: number;
  interviews: number;
  productionSeconds: number;
}
interface CallCenter {
  summary: { calls: number; connectPercent: number; missedToReturn: number; linesInUse: number; lineCapacity: number; averageTalkSeconds: number | null; agentsIdleNow: number };
  rows: AgentRow[];
  missed: { id: string; at: string; phone: string; callerName: string | null; jobSeeker: { id: string; code: string; name: string } | null; status: string; assignedTo: { id: string; name: string } | null }[];
  recordings: { id: string; code: string; at: string; purpose: string | null; direction: string | null; durationSec: number | null; agent: { id: string; name: string } | null }[];
  followUps: { key: string; label: string; due: number; done: number; overdue: number }[];
  stuck: { id: string; code: string; name: string; step: string; reason: string | null; since: string; days: number }[];
  agents: { id: string; name: string }[];
}

const STEP: Record<string, string> = { phone: 'Mobile check', consent: 'Consent', selfie: 'Selfie', idCheck: 'ID check', payment: 'Payment' };

export default function CallCenterScreen() {
  const to = useScreenPath();
  const now = useNow();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>(() => periodFor('today', now));
  const range = periodToUtcRange(period);
  const cc = useQuery({ queryKey: ['ceo', 'call-center', range], queryFn: () => api.get<CallCenter>('/ceo/call-center', { query: range }), refetchInterval: 15_000 });
  const d = cc.data;
  const s = d?.summary;
  const today = period.preset === 'today';

  const listen = async (id: string) => {
    try {
      const res = await api.get<{ url: string }>(`/calls/${id}/recording`);
      window.open(res.url, '_blank', 'noopener');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not open the recording');
    }
  };

  const columns: Column<AgentRow>[] = [
    { key: 'av', header: '', cell: (r) => <span className="avatar av-royal" style={{ width: 28, height: 28, fontSize: 10.5 }}>{initials(r.staff.name)}</span> },
    { key: 'agent', header: 'Agent', cell: (r) => r.staff.name, filter: 'text', filterValue: (r) => r.staff.name, sortValue: (r) => r.staff.name, csv: (r) => r.staff.name },
    { key: 'now', header: 'Now', cell: (r) => (r.now ? <StatusPill tone={r.now.overBreak ? 'danger' : liveLabel(r.now.status).tone}>{rightNow({ ...r.now, staff: { ...r.staff, role: 'call_agent' }, loginAt: null, lateMinutes: 0, productionSeconds: 0, breakSeconds: 0, breakOverSeconds: 0, idle: r.now.status === 'idle' }, now)}</StatusPill> : '—'), filter: 'select', filterValue: (r) => liveLabel(r.now?.status).label, csv: (r) => r.now?.status },
    { key: 'calls', header: 'Calls', cell: (r) => r.calls, sortValue: (r) => r.calls, csv: (r) => r.calls, align: 'right' },
    { key: 'answered', header: 'Answered', cell: (r) => r.answered, sortValue: (r) => r.answered, csv: (r) => r.answered, align: 'right' },
    { key: 'connect', header: 'Connect', cell: (r) => `${r.connectPercent}%`, sortValue: (r) => r.connectPercent, csv: (r) => r.connectPercent, align: 'right' },
    { key: 'talk', header: 'Talk time', cell: (r) => hm(r.talkSeconds), sortValue: (r) => r.talkSeconds, csv: (r) => Math.round(r.talkSeconds / 60), hideOnPhone: true },
    { key: 'reg', header: 'Registered', cell: (r) => r.registered, sortValue: (r) => r.registered, csv: (r) => r.registered, align: 'right' },
    { key: 'int', header: 'Interviews', cell: (r) => r.interviews, sortValue: (r) => r.interviews, csv: (r) => r.interviews, align: 'right', hideOnPhone: true },
    { key: 'prod', header: 'Production', cell: (r) => hm(r.productionSeconds), sortValue: (r) => r.productionSeconds, csv: (r) => Math.round(r.productionSeconds / 60), hideOnPhone: true },
  ];
  const agentOptions = (d?.agents ?? []).map((a) => ({ value: a.id, label: a.name }));

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('Main'), label: 'Command Center' }} title="Call center" subtitle="Live: who's on calls, how calls are going, missed calls to return and recordings to check." period={period} onPeriodChange={setPeriod} />
      <StatGrid>
        <StatTile label={today ? 'Calls today' : 'Calls'} value={s?.calls ?? '—'} tone="navy" loading={cc.isPending} />
        <StatTile label="Connect rate" value={s ? `${s.connectPercent}%` : '—'} tone="cyan" loading={cc.isPending} />
        <StatTile label="Missed calls to return" value={s?.missedToReturn ?? '—'} tone="gold" loading={cc.isPending} />
        <StatTile label="Lines in use" value={s ? `${s.linesInUse} / ${s.lineCapacity}` : '—'} tone="navy" loading={cc.isPending} />
        <StatTile label="Average talk time" value={s ? ms(s.averageTalkSeconds) : '—'} tone="good" loading={cc.isPending} />
        <StatTile label="Agent idle now" value={s?.agentsIdleNow ?? '—'} tone="red" loading={cc.isPending} to={to('C-Att-Live')} />
      </StatGrid>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={d?.rows} rowKey={(r) => r.staff.id} caption="Call agents" loading={cc.isPending} error={cc.error} onRetry={() => void cc.refetch()} download={`call-center-${period.from}-${period.to}`} emptyTitle="No call agents yet." />
        <div className="ceo-note">Live · calls are counted by the calling system, never typed · quality scores come with recording reviews</div>
      </div>
      <div className="two-col">
        <Card title={`Missed calls to return (${d?.missed.filter((m) => m.status === 'pending').length ?? 0})`}>
          {d && !d.missed.length ? (
            <p className="ceo-sub">No missed calls waiting.</p>
          ) : (
            <div className="scrollx">
              <table>
                <thead><tr><th>When</th><th>Caller</th><th>Known as</th><th /></tr></thead>
                <tbody>
                  {d?.missed.map((m) => (
                    <tr key={m.id}>
                      <td>{istDateKey(m.at) === istDateKey(now) ? formatTimeIST(m.at) : formatDateTimeIST(m.at)}</td>
                      <td>{maskMobile(m.phone)}</td>
                      <td>{m.jobSeeker ? `${m.jobSeeker.name} · ${m.jobSeeker.code}` : (m.callerName ?? 'New number')}</td>
                      <td>
                        {m.assignedTo ? (
                          <span className="ceo-sub">With {m.assignedTo.name}</span>
                        ) : (
                          <ActionButton label="Assign" title="Give this missed call to an agent" choice={{ label: 'Agent', options: agentOptions }} run={({ choice }) => api.post(`/telephony/callbacks/${m.id}/assign`, { staffId: choice })} success="Missed call assigned" disabled={!agentOptions.length} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Recordings to review">
          {d && !d.recordings.length ? (
            <p className="ceo-sub">No recordings in this period.</p>
          ) : (
            <div className="scrollx">
              <table>
                <thead><tr><th>Call</th><th>Agent</th><th>Check</th><th /></tr></thead>
                <tbody>
                  {d?.recordings.map((r) => (
                    <tr key={r.id}>
                      <td>{humanize(r.purpose ?? 'general')} · {formatTimeIST(r.at)}</td>
                      <td>{r.agent?.name ?? '—'}</td>
                      <td>{r.purpose === 'verification' ? 'Consent script read fully?' : r.purpose === 'exit_call' ? 'Did the person ask?' : 'Politeness, accuracy'}</td>
                      <td>
                        <Button onClick={() => void listen(r.id)}>▶ Review</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <div className="two-col">
        <Card title="Follow-up calls (catch bypass, check before refunds)">
          <div className="scrollx">
            <table>
              <thead><tr><th>Type</th><th>Due</th><th>Done</th><th>Overdue</th></tr></thead>
              <tbody>
                {d?.followUps.map((f) => (
                  <tr key={f.key}>
                    <td>{f.label}</td>
                    <td>{f.due}</td>
                    <td>{f.done}</td>
                    <td>{f.overdue ? <StatusPill tone="warn">{String(f.overdue)}</StatusPill> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Stuck registrations">
          {d && !d.stuck.length ? (
            <p className="ceo-sub">Nobody is stuck registering.</p>
          ) : (
            <div className="scrollx">
              <table>
                <thead><tr><th>Person</th><th>Stuck at</th><th>Since</th><th /></tr></thead>
                <tbody>
                  {d?.stuck.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name} · {p.code}</td>
                      <td>{STEP[p.step] ?? humanize(p.step)}{p.reason ? ` · ${humanize(p.reason).toLowerCase()}` : ''}</td>
                      <td>{p.days} day{p.days === 1 ? '' : 's'}</td>
                      <td>
                        <ActionButton label="Resend" title={`Resend ${p.name}'s registration link`} description="A fresh link goes by SMS and WhatsApp; it resumes where they stopped." run={() => api.post('/consent/links', { jobSeekerId: p.id })} success="Link sent" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
