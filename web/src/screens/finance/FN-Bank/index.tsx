import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST, formatDayMonthIST, formatTimeIST, istStartOfDay } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter, useDebounced } from '../../ceo/_kit/kit';
import { FormAction, Note } from '../_kit/kit';
import { AddFromStatement, SetAside } from '../_kit/statement';
import '../_kit/fin.css';

/**
 * Bank — design FN-Bank.dc.html (guide: our own books, bank matching). The
 * bank account line by line against Laboura's books, and each day closed with
 * the statement's closing balance once every line matches. Until the bank
 * sends its statement automatically, each credit is typed in from the
 * statement ("Add from statement").
 */
interface Line {
  id: string;
  at: string;
  direction: 'credit' | 'debit';
  amountPaise: number;
  what: string;
  status: string;
  reference: string | null;
  source: string;
}
interface Day {
  day: string;
  openingPaise: number;
  inPaise: number;
  outPaise: number;
  booksClosingPaise: number;
  bankClosingPaise: number | null;
  differencePaise: number | null;
  unmatched: number;
  closed: { bankClosingPaise: number; differencePaise: number; note: string | null; closedBy: string | null; closedAt: string } | null;
}
interface Response {
  lines: Line[];
  days: Day[];
  summary: { booksBalancePaise: number; lastClosedDay: string | null; lastBankClosingPaise: number | null; linesToSort: number };
}

function statusOf(l: Line): { tone: 'good' | 'warn' | 'crit' | 'muted'; text: string } {
  if (l.status === 'unknown') return { tone: 'crit', text: 'Unknown · find it' };
  if (l.status === 'matched_tds') return { tone: 'warn', text: 'Matched · TDS recorded' };
  if (l.status === 'returned') return { tone: 'muted', text: 'Returned to payer' };
  if (l.status === 'ignored') return { tone: 'muted', text: 'Set aside' };
  return { tone: 'good', text: l.reference && l.direction === 'debit' ? `Matched · ${l.source === 'expense' ? 'ref' : 'UTR'} ${l.reference}` : 'Matched' };
}

function dayLabel(day: string): string {
  return formatDayMonthIST(istStartOfDay(day));
}

function CloseDay({ d }: { d: Day }) {
  return (
    <FormAction
      label={`Close ${dayLabel(d.day)}`}
      variant="primary"
      size="compact"
      title={`Close ${formatDateIST(istStartOfDay(d.day))}`}
      description={
        <>
          Our books say the day ended at <strong>{formatINR(d.booksClosingPaise)}</strong> (opening {formatINR(d.openingPaise)} + in {formatINR(d.inPaise)} − out {formatINR(d.outPaise)}). Type the closing balance from the bank statement. If they differ, add the missing line first (for example bank charges as an expense) or write why.
        </>
      }
      fields={[
        { name: 'bankClosingPaise', kind: 'money', label: 'Closing balance on the bank statement', required: true, initial: d.booksClosingPaise },
        { name: 'note', kind: 'text', label: 'Why they differ (only if they do)' },
      ]}
      confirmLabel="Close the day"
      run={(v) => api.post('/finance/bank/close-day', { day: d.day, bankClosingPaise: v.bankClosingPaise, note: v.note || undefined })}
      success={`${dayLabel(d.day)} closed`}
      disabled={d.unmatched > 0}
    />
  );
}

export default function Bank() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const [period, setPeriod] = useState<Period>(() => periodFor('week', now));
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search).trim().toLowerCase();
  const query = useQuery({
    queryKey: ['finance', 'bank', period],
    queryFn: () => api.get<Response>('/finance/bank', { query: periodToUtcRange(period) }),
    placeholderData: keepPreviousData,
  });
  const d = query.data;
  const loading = query.isPending;
  const lines = useMemo(
    () =>
      (d?.lines ?? []).filter((l) => {
        if (type && l.direction !== type) return false;
        if (status === 'matched' && !l.status.startsWith('matched')) return false;
        if (status === 'unknown' && l.status !== 'unknown') return false;
        if (q && !`${l.what} ${l.reference ?? ''} ${l.amountPaise / 100}`.toLowerCase().includes(q)) return false;
        return true;
      }),
    [d, type, status, q],
  );
  const lineColumns: Column<Line>[] = [
    { key: 'when', header: 'When', cell: (l) => `${formatDayMonthIST(l.at)} ${formatTimeIST(l.at)}`, csv: (l) => l.at, sortValue: (l) => l.at },
    { key: 'type', header: 'Type', cell: (l) => (l.direction === 'credit' ? 'Credit' : 'Debit'), csv: (l) => l.direction },
    { key: 'amount', header: 'Amount', cell: (l) => formatINR(l.amountPaise), csv: (l) => (l.direction === 'credit' ? 1 : -1) * (l.amountPaise / 100), sortValue: (l) => l.amountPaise },
    { key: 'what', header: 'What it is', cell: (l) => l.what, csv: (l) => l.what },
    {
      key: 'status',
      header: 'Status',
      cell: (l) => {
        const st = statusOf(l);
        return (
          <>
            <StatusPill tone={st.tone}>{st.text}</StatusPill>
            {l.status === 'unknown' && (
              <span className="fin-row-actions">
                <ButtonLink size="compact" to={`${to('FN-Match')}?credit=${encodeURIComponent(l.id.replace(/^bc-/, ''))}`}>
                  Match
                </ButtonLink>
                {l.direction === 'credit' && l.id.startsWith('bc-') && <SetAside id={l.id.replace(/^bc-/, '')} amountPaise={l.amountPaise} />}
              </span>
            )}
          </>
        );
      },
      csv: (l) => statusOf(l).text,
    },
  ];
  const dayColumns: Column<Day>[] = [
    { key: 'day', header: 'Day', cell: (r) => dayLabel(r.day), csv: (r) => r.day },
    { key: 'opening', header: 'Opening', cell: (r) => formatINR(r.openingPaise), csv: (r) => r.openingPaise / 100, hideOnPhone: true },
    { key: 'in', header: 'In', cell: (r) => formatINR(r.inPaise), csv: (r) => r.inPaise / 100 },
    { key: 'out', header: 'Out', cell: (r) => formatINR(r.outPaise), csv: (r) => r.outPaise / 100 },
    { key: 'books', header: 'Closing (our books)', cell: (r) => formatINR(r.booksClosingPaise), csv: (r) => r.booksClosingPaise / 100 },
    {
      key: 'bank',
      header: 'Closing (bank)',
      cell: (r) =>
        r.closed ? (
          <>
            {formatINR(r.closed.bankClosingPaise)}
            {r.closed.differencePaise !== 0 && <span className="fin-sub fin-less">{formatINR(r.closed.differencePaise)} difference · {r.closed.note}</span>}
          </>
        ) : (
          '—'
        ),
      csv: (r) => (r.closed ? r.closed.bankClosingPaise / 100 : ''),
    },
    {
      key: 'state',
      header: 'Status',
      cell: (r) =>
        r.closed ? (
          <StatusPill tone="good">Closed{r.closed.closedBy ? ` by ${r.closed.closedBy}` : ''}</StatusPill>
        ) : r.unmatched > 0 ? (
          <StatusPill tone="crit">{r.unmatched} to sort out</StatusPill>
        ) : (
          <CloseDay d={r} />
        ),
      csv: (r) => (r.closed ? 'closed' : r.unmatched ? 'lines to sort out' : 'open'),
    },
  ];
  const nextToClose = [...(d?.days ?? [])].reverse().find((x) => !x.closed && x.unmatched === 0 && (!d?.summary.lastClosedDay || x.day > d.summary.lastClosedDay));
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('FN-Home'), label: 'Money today' }}
        title="Bank"
        subtitle={`The bank statement matched line by line to Laboura's own books. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={setPeriod}
        showSearch={false}
        actions={<AddFromStatement />}
      />
      <StatGrid>
        <StatTile label={d?.summary.lastClosedDay ? `Bank balance at close of ${dayLabel(d.summary.lastClosedDay)}` : 'Bank balance (no day closed yet)'} value={d?.summary.lastBankClosingPaise != null ? formatINR(d.summary.lastBankClosingPaise) : '—'} tone="royal" loading={loading} />
        <StatTile label="Balance in our books" value={d ? formatINR(d.summary.booksBalancePaise) : '—'} tone="good" loading={loading} />
        <StatTile label="Lines to sort out" value={d?.summary.linesToSort ?? '—'} tone="red" loading={loading} to={`${to('FN-MoneyIn')}?status=needs`} />
        <StatTile label="Last day fully matched" value={d?.summary.lastClosedDay ? dayLabel(d.summary.lastClosedDay) : '—'} tone="gold" loading={loading} />
      </StatGrid>
      <FilterPanel>
        <SelectFilter
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: '', label: 'All' },
            { value: 'credit', label: 'Credit' },
            { value: 'debit', label: 'Debit' },
          ]}
        />
        <SelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'matched', label: 'Matched' },
            { value: 'unknown', label: 'Unknown' },
          ]}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Amount, UTR or name" />
      </FilterPanel>
      <Card flush>
        <DataTable columns={lineColumns} rows={lines} rowKey={(l) => l.id} caption="Bank lines" loading={loading} error={query.error} onRetry={() => void query.refetch()} pageSize={50} download="bank-lines" emptyTitle="No rows match these filters. Change a filter to see more." />
      </Card>
      <Card title="Days" flush>
        <DataTable columns={dayColumns} rows={d?.days} rowKey={(r) => r.day} caption="Bank days" loading={loading} pageSize={31} download="bank-days" emptyTitle="No days in this period." />
      </Card>
      <Note>
        Until the bank sends its statement automatically, every line here is what Laboura recorded (credits added from the statement with “Add from statement”, payouts and refunds with their UTR, bills paid, money returned) · every line must match before the day is closed · type the statement's closing balance to close a day; a gap (such as bank charges) is added as an expense or explained
      </Note>
      <div className="fin-foot">
        <AddFromStatement variant="secondary" />
        <ButtonLink to={`${to('FN-Expenses')}?prefill=bank-charges`}>Add bank charges as an expense</ButtonLink>
        {nextToClose && <CloseDay d={nextToClose} />}
      </div>
    </div>
  );
}
