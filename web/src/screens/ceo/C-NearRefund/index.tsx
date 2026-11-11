import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatINR, sumPaise } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter } from '../_kit/kit';

/** Close to a refund — design C-NearRefund.dc.html (window from Settings, 15 days). */
export interface NearRefundRow {
  kind: 'job_seeker' | 'business';
  id: string;
  code: string;
  name: string;
  trade: string | null;
  daysLeft: number;
  bucket: '0-5' | '6-10' | '11-15';
  standing: { offers: number; declined: number; interviewsUpcoming: number; replacementsOffered: number; replacementsRejected: number };
  agent: { id: string; name: string } | null;
  atStakePaise: number;
  recordId: string;
  businessName: string | null;
}

const BUCKET = {
  '0-5': { label: 'Urgent', tone: 'danger' as const },
  '6-10': { label: 'Soon', tone: 'crit' as const },
  '11-15': { label: 'Later', tone: 'warn' as const },
};

function standing(r: NearRefundRow): string {
  const s = r.standing;
  if (r.kind === 'business') {
    if (!s.replacementsOffered) return 'No replacement sent yet';
    return `${s.replacementsOffered} replacement${s.replacementsOffered > 1 ? 's' : ''} sent${s.replacementsRejected ? ` · ${s.replacementsRejected} rejected` : ''}`;
  }
  const parts: string[] = [];
  if (s.declined) parts.push(`${s.declined} offer${s.declined > 1 ? 's' : ''} turned down (not suitable)`);
  if (s.interviewsUpcoming) parts.push(`${s.interviewsUpcoming} interview booked`);
  return parts.length ? parts.join(' · ') : 'No suitable offer yet';
}

function RowActions({ row }: { row: NearRefundRow }) {
  const toast = useToast();
  const [done, setDone] = useState<string | null>(null);
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
  const call = useMutation({
    mutationFn: () => api.post('/calls', { subjectType: row.kind === 'job_seeker' ? 'job_seeker' : 'business', subjectId: row.id, purpose: 'general' }),
    onSuccess: () => {
      setDone('Calling — your phone rings first');
      toast.success(`Calling ${row.name} through the calling system`);
    },
    onError,
  });
  const remind = useMutation({
    mutationFn: () => api.post<{ created: boolean }>('/ceo/near-refund/remind', { kind: row.kind === 'job_seeker' ? 'job_seeker' : 'placement', id: row.recordId }),
    onSuccess: (res) => {
      const msg = res.created ? `${row.agent?.name ?? 'The agent'} has a priority call task` : 'Already reminded — the task is still open';
      setDone(msg);
      toast.success(msg);
    },
    onError,
  });
  return (
    <span className="ceo-actions" onClick={(e) => e.stopPropagation()}>
      <Button size="compact" onClick={() => call.mutate()} loading={call.isPending}>
        Call
      </Button>
      <Button size="compact" onClick={() => remind.mutate()} loading={remind.isPending} disabled={!row.agent}>
        Remind the agent
      </Button>
      {done && <StatusPill tone="good">{done}</StatusPill>}
    </span>
  );
}

export default function NearRefund() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const [who, setWho] = useState('');
  const [soon, setSoon] = useState('');
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: ['ceo', 'near-refund'], queryFn: () => api.get<{ windowDays: number; rows: NearRefundRow[] }>('/ceo/near-refund') });
  const all = useMemo(() => query.data?.rows ?? [], [query.data]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all.filter(
      (r) => (!who || r.kind === who) && (!soon || r.bucket === soon) && (!s || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s)),
    );
  }, [all, who, soon, search]);
  const seekers = all.filter((r) => r.kind === 'job_seeker');
  const biz = all.filter((r) => r.kind === 'business');
  const loading = query.isPending;
  const windowDays = query.data?.windowDays ?? 15;

  const columns: Column<NearRefundRow>[] = [
    {
      key: 'who',
      header: 'Who',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.code} · {r.name}
          </div>
          <div className="ceo-cell-sub">{r.kind === 'job_seeker' ? 'Job seeker' : 'Business · placement refund'}</div>
        </div>
      ),
      csv: (r) => `${r.code} ${r.name}`,
      sortValue: (r) => r.name,
    },
    { key: 'trade', header: 'Trade', cell: (r) => r.trade ?? '—', csv: (r) => r.trade, hideOnPhone: true },
    {
      key: 'due',
      header: 'Refund due in',
      cell: (r) => <StatusPill tone={BUCKET[r.bucket].tone}>{r.daysLeft === 1 ? '1 day left' : `${r.daysLeft} days left`}</StatusPill>,
      csv: (r) => r.daysLeft,
      sortValue: (r) => r.daysLeft,
    },
    { key: 'soon', header: 'How soon', cell: (r) => <StatusPill tone={BUCKET[r.bucket].tone}>{BUCKET[r.bucket].label}</StatusPill>, csv: (r) => BUCKET[r.bucket].label, hideOnPhone: true },
    { key: 'standing', header: 'Where it stands', cell: (r) => standing(r), csv: (r) => standing(r), hideOnPhone: true },
    { key: 'agent', header: 'Agent', cell: (r) => r.agent?.name ?? '—', csv: (r) => r.agent?.name },
    { key: 'stake', header: 'At stake', cell: (r) => formatINR(r.atStakePaise), csv: (r) => r.atStakePaise / 100, sortValue: (r) => r.atStakePaise, align: 'right' },
    { key: 'act', header: '', cell: (r) => <RowActions row={r} /> },
  ];

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Close to a refund"
        subtitle={`Job seekers and businesses whose refund falls due in the next ${windowDays} days — call them, get them a job or a replacement.`}
      />
      <StatGrid>
        <StatTile label={`Job seekers · refund due within ${windowDays} days`} value={seekers.length} tone="cyan" loading={loading} />
        <StatTile label="Job seeker refunds at stake" value={formatINR(sumPaise(seekers.map((r) => r.atStakePaise)))} tone="orange" loading={loading} />
        <StatTile label={`Businesses · refund due within ${windowDays} days`} value={biz.length} tone="royal" loading={loading} />
        <StatTile label="Business refunds at stake" value={formatINR(sumPaise(biz.map((r) => r.atStakePaise)))} tone="orange" loading={loading} />
        <StatTile label="Urgent · 0–5 days" value={all.filter((r) => r.bucket === '0-5').length} tone="red" loading={loading} />
      </StatGrid>
      <FilterPanel>
        <SelectFilter
          label="Who"
          value={who}
          onChange={setWho}
          options={[
            { value: '', label: 'Everyone' },
            { value: 'job_seeker', label: 'Job seekers' },
            { value: 'business', label: 'Businesses' },
          ]}
        />
        <SelectFilter
          label="How soon"
          value={soon}
          onChange={setSoon}
          options={[
            { value: '', label: `Any time in ${windowDays} days` },
            { value: '0-5', label: 'Urgent · 0–5 days' },
            { value: '6-10', label: 'Soon · 6–10 days' },
            { value: '11-15', label: 'Later · 11–15 days' },
          ]}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Name or code" />
      </FilterPanel>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.kind}-${r.recordId}`}
          caption="Close to a refund"
          loading={loading}
          error={query.error}
          onRetry={() => void query.refetch()}
          emptyTitle="No rows match these filters. Change a filter to see more."
          download="close-to-a-refund"
          onRowClick={(r) => navigate(r.kind === 'job_seeker' ? to('C-JobSeeker', { id: r.recordId }) : to('C-Placement', { id: r.recordId }))}
        />
        <div className="ceo-note">
          Job seekers: {windowDays}-day window before the 30-day guarantee ends with no suitable offer yet · Businesses: placement refund from day 15 of the replacement search · the window is set in Settings ·
          showing {rows.length} of {all.length}
        </div>
      </div>
    </div>
  );
}
