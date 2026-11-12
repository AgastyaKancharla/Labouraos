import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { SelectField } from '../../../components/fields';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateIST, formatTimeIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import '../../ceo/_kit/ceo.css';
import { firstName, useTeam, type Brief } from '../_kit/api';

/** Work list — design T-Work.dc.html, plus N2 (paid, no interview 10+ days) and N3 shortage tasks. */
interface Work {
  summary: { stuck: number; followUpsOverdue: number; interviewsToday: number; resultsOverdue: number };
  stuck: Array<{ jobSeeker: { id: string; code: string; firstName: string }; agent: Brief | null; where: string; hours: number }>;
  interviews: Array<{ id: string; at: string; jobSeeker: { code: string; firstName: string }; trade: string | null; business: string; fieldAgent: Brief | null; status: string }>;
  businesses: Array<{ id: string; code: string; name: string; locality: string | null; accountAgent: Brief | null }>;
  fieldAgents: Brief[];
}
interface Refund {
  rows: Array<{ kind: string; id: string; code: string; name: string | null; trade: string | null; daysLeft: number; agent: { id: string; name: string } | null }>;
}
interface N2 {
  rows: Array<{ jobSeekerId: string; code: string; firstName: string; trade: string | null; daysSincePaid: number; daysLeftOnGuarantee: number; registeredBy: { id: string; name: string } | null }>;
}
interface Shortage {
  id: string;
  trade: string;
  area: string;
  openPositions: number;
  title: string;
}

export default function TeamLeadWork() {
  const to = useScreenPath();
  const now = useNow();
  const team = useTeam();
  const work = useQuery({ queryKey: ['team-lead', 'work'], queryFn: () => api.get<Work>('/team-lead/work') });
  const refund = useQuery({ queryKey: ['close-to-refund', 'job_seekers'], queryFn: () => api.get<Refund>('/close-to-refund', { query: { who: 'job_seekers' } }) });
  const n2 = useQuery({ queryKey: ['growth', 'days-to-first-interview'], queryFn: () => api.get<N2>('/growth/days-to-first-interview') });
  const n3 = useQuery({ queryKey: ['growth', 'shortage-tasks'], queryFn: () => api.get<Shortage[]>('/growth/shortage-tasks') });
  const w = work.data;
  const mgr = team.data?.manager ? firstName(team.data.manager.name) : 'the Manager';

  const refundColumns: Column<Refund['rows'][number]>[] = [
    { key: 'js', header: 'Job seeker', cell: (r) => <div><div className="tl-strong">{r.code} · {firstName(r.name)}</div><div className="tl-sub">{r.trade ?? ''}</div></div> },
    { key: 'due', header: 'Refund due in', cell: (r) => <StatusPill tone={r.daysLeft <= 5 ? 'danger' : r.daysLeft <= 10 ? 'warn' : 'info'}>{r.daysLeft} day{r.daysLeft === 1 ? '' : 's'}</StatusPill>, sortValue: (r) => r.daysLeft },
    { key: 'agent', header: 'Agent', cell: (r) => r.agent?.name ?? '—' },
    { key: 'act', header: '', cell: (r) => (r.agent ? <Remind staffId={r.agent.id} jobSeekerId={r.id} name={r.agent.name} /> : null) },
  ];
  const n2Columns: Column<N2['rows'][number]>[] = [
    { key: 'js', header: 'Job seeker', cell: (r) => <div><div className="tl-strong">{r.code} · {r.firstName}</div><div className="tl-sub">{r.trade ?? ''}</div></div> },
    { key: 'days', header: 'Days since paying', cell: (r) => `${r.daysSincePaid} days`, sortValue: (r) => r.daysSincePaid },
    { key: 'left', header: 'Guarantee left', cell: (r) => `${r.daysLeftOnGuarantee} days` },
    { key: 'agent', header: 'Agent', cell: (r) => r.registeredBy?.name ?? '—' },
    { key: 'act', header: '', cell: (r) => (r.registeredBy ? <Remind staffId={r.registeredBy.id} jobSeekerId={r.jobSeekerId} name={r.registeredBy.name} text="Paid 10+ days ago, no interview booked yet — find a match today" /> : null) },
  ];
  const stuckColumns: Column<Work['stuck'][number]>[] = [
    { key: 'js', header: 'Job seeker', cell: (r) => `${r.jobSeeker.code} · ${r.jobSeeker.firstName}` },
    { key: 'agent', header: 'Agent', cell: (r) => r.agent?.name ?? '—', filter: 'select', filterValue: (r) => r.agent?.name ?? '—' },
    { key: 'where', header: 'Where it stopped', cell: (r) => `${r.where} · ${r.hours} h`, sortValue: (r) => r.hours },
    { key: 'act', header: '', cell: (r) => (r.agent ? <Remind staffId={r.agent.id} jobSeekerId={r.jobSeeker.id} name={r.agent.name} text={`Registration stopped: ${r.where.toLowerCase()} — call him`} /> : null) },
  ];
  const interviewColumns: Column<Work['interviews'][number]>[] = [
    { key: 'when', header: 'When', cell: (r) => (istDateKey(r.at) === istDateKey(now) ? formatTimeIST(r.at) : formatDateIST(r.at)), sortValue: (r) => r.at },
    { key: 'js', header: 'Job seeker', cell: (r) => `${r.jobSeeker.firstName}${r.trade ? ` · ${r.trade}` : ''}` },
    { key: 'biz', header: 'Business', cell: (r) => r.business },
    { key: 'fa', header: 'Field agent', cell: (r) => r.fieldAgent?.name ?? '—' },
    { key: 'status', header: 'Status', cell: (r) => <StatusPill tone={r.status === 'Owner result overdue' ? 'danger' : r.status === 'Arrived' ? 'good' : 'info'}>{r.status}</StatusPill> },
  ];

  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Work list" subtitle="What is stuck or due today in your team's work." />
      <StatGrid>
        <StatTile label="Registrations stuck over 24 h" value={w?.summary.stuck ?? '—'} tone="orange" loading={work.isPending} />
        <StatTile label="Follow-ups overdue" value={w?.summary.followUpsOverdue ?? '—'} tone="red" loading={work.isPending} />
        <StatTile label="Interviews today" value={w?.summary.interviewsToday ?? '—'} tone="royal" loading={work.isPending} />
        <StatTile label="Owner results overdue" value={w?.summary.resultsOverdue ?? '—'} tone="gold" loading={work.isPending} />
      </StatGrid>
      <Card title="Close to a refund · call these first" flush>
        <DataTable columns={refundColumns} rows={refund.data?.rows} rowKey={(r) => r.id} caption="Close to a refund" loading={refund.isPending} error={refund.error} onRetry={() => void refund.refetch()} emptyTitle="Nobody in your team is close to a refund." />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>Refund due within 15 days and no suitable offer yet · these come first in your agents' Call next and matching</div>
      </Card>
      <Card title="Paid, no interview after 10+ days" flush>
        <DataTable columns={n2Columns} rows={n2.data?.rows} rowKey={(r) => r.jobSeekerId} caption="Paid job seekers with no interview booked 10 or more days after paying" loading={n2.isPending} error={n2.error} emptyTitle="Every paid job seeker has an interview within 10 days." />
      </Card>
      {(n3.data?.length ?? 0) > 0 && (
        <Card title="Shortage tasks · register this trade here">
          {n3.data!.map((s) => (
            <div className="tl-attn" key={s.id} style={{ gridTemplateColumns: '1fr auto' }}>
              <span>{s.title}</span>
              <StatusPill tone="warn">{s.openPositions} open</StatusPill>
            </div>
          ))}
        </Card>
      )}
      <Card title="Registrations stuck" flush>
        <DataTable columns={stuckColumns} rows={w?.stuck} rowKey={(r) => r.jobSeeker.id} caption="Registrations stuck" loading={work.isPending} error={work.error} emptyTitle="No registration is stuck." />
      </Card>
      <Card title="Interviews" flush>
        <DataTable columns={interviewColumns} rows={w?.interviews} rowKey={(r) => r.id} caption="Interviews" loading={work.isPending} error={work.error} emptyTitle="No interviews today and no results overdue." />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>Owners record the result by 8 PM · if they don't, the agent calls them and after 24 hours it shows here</div>
      </Card>
      <MoveBusiness work={w} managerName={mgr} />
    </div>
  );
}

function Remind({ staffId, jobSeekerId, name, text }: { staffId: string; jobSeekerId: string; name: string; text?: string }) {
  const toast = useToast();
  const remind = useMutation({
    mutationFn: () => api.post('/team-lead/remind', { staffId, jobSeekerId, text }),
    onSuccess: () => toast.success(`Reminded ${name}`),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not send the reminder'),
  });
  return (
    <Button size="compact" onClick={() => remind.mutate()} loading={remind.isPending}>
      Remind the agent
    </Button>
  );
}

function MoveBusiness({ work, managerName }: { work: Work | undefined; managerName: string }) {
  const [business, setBusiness] = useState('');
  const [agent, setAgent] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: () => api.post<{ to: Brief }>(`/team-lead/businesses/${business}/move`, { toStaffId: agent }),
    onSuccess: (res) => {
      toast.success(`Moved to ${res.to.name} · its vacancies, interviews and follow-ups move with it`);
      setBusiness('');
      setAgent('');
      void qc.invalidateQueries({ queryKey: ['team-lead', 'work'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not move the business'),
  });
  return (
    <Card title="Move a business to another agent">
      <div className="ceo-form-row">
        <SelectField
          label="Business"
          value={business}
          onChange={setBusiness}
          options={[{ value: '', label: 'Pick a business' }, ...(work?.businesses ?? []).map((b) => ({ value: b.id, label: `${b.name}${b.locality ? ` · ${b.locality}` : ''} (${b.accountAgent?.name ?? '—'})` }))]}
        />
        <SelectField label="Move to" value={agent} onChange={setAgent} options={[{ value: '', label: 'Pick a field agent' }, ...(work?.fieldAgents ?? []).map((a) => ({ value: a.id, label: a.name }))]} />
        <div>
          <Button variant="primary" onClick={() => move.mutate()} disabled={!business || !agent} loading={move.isPending}>
            Move business
          </Button>
        </div>
      </div>
      <div className="tl-note">Its vacancies, interviews and follow-ups move with it · moving to another team is done by {managerName}</div>
    </Card>
  );
}
