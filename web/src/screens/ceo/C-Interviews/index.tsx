import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST, formatTimeIST } from '../../../lib/format/date';
import { periodFor, periodRangeLabel, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { humanize } from '../_kit/kit';

/** Interviews — design C-Interviews.dc.html. */
interface Row {
  id: string;
  code: string;
  slotStartsAt: string;
  slotEndsAt: string;
  jobSeeker: { id: string; code: string; name: string };
  trade: string;
  vacancy: { id: string; code: string };
  business: { id: string; code: string; name: string };
  owner: string | null;
  type: string;
  fieldAgent: string | null;
  status: string;
  result: string | null;
  resultDueAt: string;
  overdue: boolean;
  offerSentAt: string;
  replyDueAt: string;
  candidateCheckAnswer: string | null;
}
interface Response {
  summary: { today: number; inRange: number; resultsDueToday: number; resultsOverdue: number; mismatches: number; awaitingReply: number; noShowsThisWeek: number };
  rows: Row[];
  resultsPending: Row[];
  mismatches: Row[];
  awaitingReply: Row[];
}

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  offered: { label: 'Offer sent', tone: 'info' },
  confirmed: { label: 'Booked', tone: 'info' },
  completed: { label: 'Done', tone: 'good' },
  no_show: { label: "Didn't turn up", tone: 'warn' },
  no_result: { label: 'No result', tone: 'crit' },
  declined: { label: 'Declined', tone: 'muted' },
  no_reply: { label: 'No reply', tone: 'muted' },
};
const RESULT: Record<string, string> = { selected: 'Selected', not_selected: 'Not selected', no_show: "Didn't turn up" };

function statusOf(r: Row) {
  if (r.result) return <StatusPill tone={r.result === 'selected' ? 'good' : 'muted'}>{RESULT[r.result] ?? humanize(r.result)}</StatusPill>;
  if (r.overdue) return <StatusPill tone="crit">Result overdue</StatusPill>;
  const s = STATUS[r.status];
  return <StatusPill tone={s?.tone ?? 'muted'}>{s?.label ?? humanize(r.status)}</StatusPill>;
}

function time(r: Row) {
  return r.type === 'walk_in' || r.type === 'walk-in' ? `${formatTimeIST(r.slotStartsAt)} – ${formatTimeIST(r.slotEndsAt)}` : formatDateTimeIST(r.slotStartsAt);
}

function SmallTable({ title, rows, headers, cells, empty }: { title: string; rows: Row[]; headers: string[]; cells: (r: Row) => ReactNode[]; empty: string }) {
  return (
    <Card title={title} flush>
      <div className="scrollx">
        <table>
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              {headers.map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {cells(r).map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={headers.length} className="ceo-sub">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Interviews() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const [period, setPeriod] = useState<Period>(() => periodFor('today', now));
  const query = useQuery({ queryKey: ['ceo', 'interviews', period.from, period.to], queryFn: () => api.get<Response>('/ceo/interviews', { query: periodToUtcRange(period) }) });
  const d = query.data;
  const s = d?.summary;
  const loading = query.isPending;
  const who = (r: Row) => (
    <Link to={to('C-JobSeeker', { id: r.jobSeeker.id })} onClick={(e) => e.stopPropagation()}>
      {r.jobSeeker.name}
    </Link>
  );

  const columns: Column<Row>[] = [
    { key: 'time', header: 'Time', cell: time, csv: (r) => r.slotStartsAt, sortValue: (r) => r.slotStartsAt },
    {
      key: 'candidate',
      header: 'Candidate',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.jobSeeker.name}</div>
          <div className="ceo-cell-sub">
            {r.jobSeeker.code} · {r.trade}
          </div>
        </div>
      ),
      csv: (r) => `${r.jobSeeker.code} ${r.jobSeeker.name}`,
    },
    { key: 'business', header: 'Business', cell: (r) => r.business.name, csv: (r) => r.business.name },
    { key: 'type', header: 'Type', cell: (r) => (r.type === 'in_person' ? 'In person' : humanize(r.type)), csv: (r) => r.type, hideOnPhone: true },
    { key: 'agent', header: 'Field agent', cell: (r) => r.fieldAgent ?? '—', csv: (r) => r.fieldAgent, hideOnPhone: true },
    { key: 'status', header: 'Status', cell: statusOf, csv: (r) => r.result ?? r.status, filter: 'select', filterValue: (r) => (r.result ? (RESULT[r.result] ?? r.result) : (STATUS[r.status]?.label ?? r.status)) },
  ];

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Interviews"
        subtitle={`Every interview, results due, offers waiting for a reply — and the mismatches that point to bypass. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={setPeriod}
      />
      <StatGrid>
        <StatTile label="Interviews today" value={s?.today ?? '—'} tone="cyan" loading={loading} />
        <StatTile label="Results due by 8 PM" value={s?.resultsDueToday ?? '—'} tone="gold" loading={loading} />
        <StatTile label="Result overdue (owner)" value={s?.resultsOverdue ?? '—'} tone="orange" loading={loading} />
        <StatTile label={'"Did they offer?" mismatch'} value={s?.mismatches ?? '—'} tone="red" loading={loading} />
        <StatTile label="Offers awaiting reply (48 h)" value={s?.awaitingReply ?? '—'} tone="royal" loading={loading} />
        <StatTile label="No-shows this week" value={s?.noShowsThisWeek ?? '—'} tone="gold" loading={loading} />
      </StatGrid>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable
          columns={columns}
          rows={d?.rows}
          rowKey={(r) => r.id}
          caption="Interviews in the period"
          loading={loading}
          error={query.error}
          onRetry={() => void query.refetch()}
          emptyTitle="No interviews in this period."
          download="interviews"
          initialSort={{ key: 'time', direction: 'asc' }}
          onRowClick={(r) => navigate(to('C-Vacancy', { id: r.vacancy.id }))}
        />
        <div className="ceo-note">Owners record the result by OTP by 8 PM; if they don't, the agent calls and after 24 hours the Team Lead is told.</div>
      </div>
      <div className="two-col">
        <SmallTable
          title="Results pending"
          rows={d?.resultsPending ?? []}
          headers={['Interview', 'Owner', 'Due', 'Status']}
          cells={(r) => [
            <>
              {who(r)} · {r.business.name}
            </>,
            r.owner ?? '—',
            formatDateTimeIST(r.resultDueAt),
            r.overdue ? <StatusPill tone="crit">Overdue · agent calling</StatusPill> : <StatusPill tone="warn">Waiting</StatusPill>,
          ]}
          empty="No results waiting."
        />
        <SmallTable
          title={'"Did they offer you the job?" mismatches'}
          rows={d?.mismatches ?? []}
          headers={['Candidate', 'Owner said', 'Candidate said', '']}
          cells={(r) => [
            <>
              {who(r)} · {r.business.name}
            </>,
            'Not selected',
            'Yes, they offered me the job',
            <Link to={to('C-Audit-Flags')}>Open flag</Link>,
          ]}
          empty="No mismatches — owners and candidates agree."
        />
      </div>
      <SmallTable
        title="Offers awaiting the candidate's reply"
        rows={d?.awaitingReply ?? []}
        headers={['Candidate', 'Job', 'Sent', 'Reply by', 'Status']}
        cells={(r) => [who(r), `${r.trade} · ${r.business.name}`, formatDateTimeIST(r.offerSentAt), formatDateTimeIST(r.replyDueAt), <StatusPill tone="info">Waiting</StatusPill>]}
        empty="No offers waiting for a reply."
      />
    </div>
  );
}
