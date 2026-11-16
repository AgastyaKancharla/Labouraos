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
import { OpenLink, humanize } from '../_kit/kit';
import { homeBack, useRecordsPortal } from '../_kit/records';

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

type View = 'all' | 'today' | 'due_today' | 'overdue' | 'mismatch' | 'awaiting' | 'no_show';
const VIEW_CAPTION: Record<View, string> = {
  all: 'Interviews in the period',
  today: 'Interviews today',
  due_today: 'Results due by 8 PM',
  overdue: 'Results overdue (owner)',
  mismatch: '"Did they offer?" mismatches',
  awaiting: 'Offers awaiting reply',
  no_show: 'No-shows in the period',
};

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
  const { api: base, link, to } = useRecordsPortal();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const [period, setPeriod] = useState<Period>(() => periodFor('today', now));
  // Which rows the main table shows: every interview in the period, or a tile's own rows.
  const [view, setView] = useState<View>('all');
  const query = useQuery({ queryKey: [base, 'interviews', period.from, period.to], queryFn: () => api.get<Response>(`${base}/interviews`, { query: periodToUtcRange(period) }) });
  const d = query.data;
  const s = d?.summary;
  const loading = query.isPending;
  const flagsScreen = link('C-Audit-Flags') ?? link('MG-Flags');
  const who = (r: Row) => (
    <Link to={to('C-JobSeeker', { id: r.jobSeeker.id })} onClick={(e) => e.stopPropagation()}>
      {r.jobSeeker.name}
    </Link>
  );
  /** A tile shows its own rows in the table (click it again to show every interview). */
  const tile = (next: View, preset?: 'today' | 'week') => () => {
    if (view === next) {
      setView('all');
      return;
    }
    if (preset) setPeriod(periodFor(preset, now));
    setView(next);
  };
  const rows = ((): Row[] | undefined => {
    if (!d) return undefined;
    switch (view) {
      case 'due_today':
        return d.resultsPending.filter((r) => !r.overdue);
      case 'overdue':
        return d.resultsPending.filter((r) => r.overdue);
      case 'mismatch':
        return d.mismatches;
      case 'awaiting':
        return d.awaitingReply;
      case 'no_show':
        return d.rows.filter((r) => r.status === 'no_show' || r.result === 'no_show');
      default:
        return d.rows;
    }
  })();

  const columns: Column<Row>[] = [
    { key: 'time', header: 'Time', cell: time, csv: (r) => r.slotStartsAt, sortValue: (r) => r.slotStartsAt },
    {
      key: 'candidate',
      header: 'Candidate',
      cell: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{who(r)}</div>
          <div className="ceo-cell-sub">
            {r.jobSeeker.code} · {r.trade}
          </div>
        </div>
      ),
      csv: (r) => `${r.jobSeeker.code} ${r.jobSeeker.name}`,
    },
    {
      key: 'business',
      header: 'Business',
      cell: (r) => (
        <Link to={to('C-Business', { id: r.business.id })} onClick={(e) => e.stopPropagation()}>
          {r.business.name}
        </Link>
      ),
      csv: (r) => r.business.name,
    },
    { key: 'type', header: 'Type', cell: (r) => (r.type === 'in_person' ? 'In person' : humanize(r.type)), csv: (r) => r.type, hideOnPhone: true },
    { key: 'agent', header: 'Field agent', cell: (r) => r.fieldAgent ?? '—', csv: (r) => r.fieldAgent, hideOnPhone: true },
    { key: 'status', header: 'Status', cell: statusOf, csv: (r) => r.result ?? r.status, filter: 'select', filterValue: (r) => (r.result ? (RESULT[r.result] ?? r.result) : (STATUS[r.status]?.label ?? r.status)) },
    // The vacancy page lists every candidate shown and interviewed for it, with this interview.
    { key: 'open', header: '', cell: (r) => <OpenLink to={to('C-Vacancy', { id: r.vacancy.id })} label={`Open ${r.vacancy.code} →`} /> },
  ];

  return (
    <div className="lb-page">
      <TopBar
        back={homeBack(link)}
        title="Interviews"
        subtitle={`Every interview, results due, offers waiting for a reply — and the mismatches that point to bypass. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={(p) => {
          setPeriod(p);
          if (view === 'today') setView('all');
        }}
      />
      <StatGrid>
        <StatTile label="Interviews today" value={s?.today ?? '—'} tone="cyan" loading={loading} onClick={tile('today', 'today')} active={view === 'today'} />
        <StatTile label="Results due by 8 PM" value={s?.resultsDueToday ?? '—'} tone="gold" loading={loading} onClick={tile('due_today')} active={view === 'due_today'} />
        <StatTile label="Result overdue (owner)" value={s?.resultsOverdue ?? '—'} tone="orange" loading={loading} onClick={tile('overdue')} active={view === 'overdue'} />
        <StatTile label={'"Did they offer?" mismatch'} value={s?.mismatches ?? '—'} tone="red" loading={loading} onClick={tile('mismatch')} active={view === 'mismatch'} />
        <StatTile label="Offers awaiting reply (48 h)" value={s?.awaitingReply ?? '—'} tone="royal" loading={loading} onClick={tile('awaiting')} active={view === 'awaiting'} />
        <StatTile label="No-shows this week" value={s?.noShowsThisWeek ?? '—'} tone="gold" loading={loading} onClick={tile('no_show', 'week')} active={view === 'no_show'} />
      </StatGrid>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          caption={VIEW_CAPTION[view]}
          loading={loading}
          error={query.error}
          onRetry={() => void query.refetch()}
          emptyTitle={view === 'all' || view === 'today' ? 'No interviews in this period.' : 'No interviews match this tile.'}
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
            flagsScreen ? <Link to={flagsScreen}>Open flag</Link> : '—',
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
