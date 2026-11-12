import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { LinkTabs } from '../../../components/Tabs';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter, useDebounced } from '../../ceo/_kit/kit';
import { FormAction, Note, days } from '../_kit/kit';
import '../_kit/fin.css';

/**
 * Invoices — design FN-Invoices.dc.html. Every GST invoice and ₹499 receipt,
 * and which placement fees are still unpaid. Invoices are numbered when the
 * fee is paid; ₹499 registration fees carry no GST, so they get a receipt.
 */
interface Row {
  id: string;
  kind: 'invoice' | 'receipt';
  number: string | null;
  to: { code: string; name: string } | null;
  forWhat: { type: string; placementCode: string | null; placementId: string | null };
  feePaise: number;
  gstPaise: number;
  totalPaise: number;
  date: string;
  status: 'paid' | 'tds_due' | 'tds_received' | 'waiting' | 'overdue' | 'less' | 'receipt';
  waitingDays: number | null;
  tds: { id: string; amountPaise: number; status: string; note: string } | null;
  shortByPaise: number | null;
  paymentId: string | null;
  downloadPath: string | null;
}
interface Response {
  rows: Row[];
  summary: { invoiceCount: number; invoicedPaise: number; overdueCount: number; unpaidCount: number; unpaidPaise: number; receiptCount: number };
}

function statusOf(r: Row): { tone: 'good' | 'warn' | 'crit' | 'muted' | 'info'; text: string } {
  switch (r.status) {
    case 'paid':
      return { tone: 'good', text: 'Paid' };
    case 'tds_due':
      return { tone: 'warn', text: `${formatINR(r.tds?.amountPaise ?? 0)} TDS · certificate due` };
    case 'tds_received':
      return { tone: 'good', text: `Paid · TDS certificate received` };
    case 'waiting':
      return { tone: 'info', text: `Waiting · ${days(r.waitingDays ?? 0)}` };
    case 'overdue':
      return { tone: 'crit', text: `Unpaid · ${days(r.waitingDays ?? 0)}` };
    case 'less':
      return { tone: 'warn', text: `${r.shortByPaise ? formatINR(r.shortByPaise) : ''} less · asked` };
    default:
      return { tone: 'good', text: 'Receipt sent' };
  }
}

function forText(r: Row): string {
  return r.kind === 'receipt' ? 'Registration fee (no GST)' : `Placement fee · ${r.forWhat.placementCode ?? ''}`;
}

function Actions({ r }: { r: Row }) {
  return (
    <span className="fin-row-actions">
      {r.downloadPath && (
        <a className="btn2 lb-btn" href={r.downloadPath} target="_blank" rel="noopener noreferrer">
          {r.kind === 'receipt' ? 'Open receipt' : 'Open invoice'}
        </a>
      )}
      {r.status === 'tds_due' && r.tds && (
        <FormAction
          label="Mark certificate received"
          size="compact"
          title="TDS certificate received"
          description={`The business has sent the TDS certificate for ${formatINR(r.tds.amountPaise)} (${r.tds.note}).`}
          run={() => api.post(`/finance/tds-receivables/${r.tds!.id}/certificate-received`)}
          success="Certificate marked received"
        />
      )}
      {['waiting', 'overdue', 'less'].includes(r.status) && r.paymentId && (
        <FormAction
          label="Send reminder"
          size="compact"
          title="Send the payment link again"
          description={`${r.to?.name ?? 'The business'} gets the payment link for ${formatINR(r.totalPaise)} again by SMS and WhatsApp.`}
          run={() => api.post(`/payments/${r.paymentId}/resend`)}
          success="Reminder sent"
        />
      )}
      {r.status === 'overdue' && r.kind === 'invoice' && r.paymentId && (
        <FormAction
          label="Tell the account agent"
          size="compact"
          title="Tell the account agent"
          confirmLabel="Send the bell"
          description={`The field agent who looks after ${r.to?.name ?? 'this business'} gets a bell to call the owner about the unpaid fee (no amount is shown to agents).`}
          run={() => api.post<{ told: { name: string } }>(`/finance/invoices/${r.paymentId}/tell-account-agent`)}
          success={(res) => `${(res as { told?: { name?: string } }).told?.name ?? 'The account agent'} has been told`}
        />
      )}
    </span>
  );
}

export default function Invoices() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const query = useQuery({
    queryKey: ['finance', 'invoices', period, status, type, q],
    queryFn: () => api.get<Response>('/finance/invoices', { query: { ...periodToUtcRange(period), status, type, search: q } }),
    placeholderData: keepPreviousData,
  });
  const s = query.data?.summary;
  const loading = query.isPending;
  const columns = useMemo<Column<Row>[]>(
    () => [
      { key: 'number', header: 'Number', cell: (r) => r.number ?? <span className="fin-sub">Made when paid</span>, csv: (r) => r.number, sortValue: (r) => r.number ?? '' },
      { key: 'to', header: 'To', cell: (r) => (r.to ? (r.kind === 'receipt' ? `${r.to.code} · ${r.to.name}` : r.to.name) : '—'), csv: (r) => r.to?.name },
      { key: 'for', header: 'For', cell: forText, csv: forText, hideOnPhone: true },
      { key: 'fee', header: 'Fee + GST 18%', cell: (r) => (r.gstPaise ? `${formatINR(r.feePaise)} + ${formatINR(r.gstPaise)}` : formatINR(r.feePaise)), csv: (r) => r.feePaise / 100, hideOnPhone: true },
      { key: 'total', header: 'Total', cell: (r) => formatINR(r.totalPaise), csv: (r) => r.totalPaise / 100, sortValue: (r) => r.totalPaise },
      {
        key: 'status',
        header: 'Status',
        cell: (r) => {
          const st = statusOf(r);
          return (
            <>
              <StatusPill tone={st.tone}>{st.text}</StatusPill>
              <span className="fin-sub">{formatDateIST(r.date)}</span>
              <Actions r={r} />
            </>
          );
        },
        csv: (r) => statusOf(r).text,
      },
    ],
    [],
  );
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('FN-Home'), label: 'Money today' }}
        title="Invoices"
        subtitle={`Every GST invoice and receipt, and which ones are still unpaid. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={setPeriod}
        showSearch={false}
      />
      <LinkTabs
        label="Invoices and credit notes"
        items={[
          { to: to('FN-Invoices'), label: 'Invoices', end: true },
          { to: to('FN-CreditNotes'), label: 'Credit notes' },
        ]}
      />
      <StatGrid>
        <StatTile label="Placement invoices" value={s?.invoiceCount ?? '—'} tone="royal" loading={loading} />
        <StatTile label="Invoiced incl. GST" value={s ? formatINR(s.invoicedPaise) : '—'} tone="good" loading={loading} />
        <StatTile label="Unpaid past their due time" value={s?.overdueCount ?? '—'} tone="red" loading={loading} />
        <StatTile label={`Unpaid · ${s?.unpaidCount ?? 0}`} value={s ? formatINR(s.unpaidPaise) : '—'} tone="orange" loading={loading} />
      </StatGrid>
      <FilterPanel>
        <SelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'paid', label: 'Paid' },
            { value: 'unpaid', label: 'Waiting' },
            { value: 'overdue', label: 'Past due' },
            { value: 'tds_due', label: 'Certificate due' },
            { value: 'less', label: 'Less' },
          ]}
        />
        <SelectFilter
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: '', label: 'All' },
            { value: 'placement_fee', label: 'Placement fee' },
            { value: 'activation', label: 'Registration fee' },
          ]}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Invoice number or business" />
      </FilterPanel>
      <Card flush>
        <DataTable
          columns={columns}
          rows={query.data?.rows}
          rowKey={(r) => `${r.kind}-${r.id}`}
          caption="Invoices and receipts"
          loading={loading}
          error={query.error}
          onRetry={() => void query.refetch()}
          pageSize={50}
          download="invoices"
          emptyTitle="No rows match these filters. Change a filter to see more."
        />
      </Card>
      <Note>
        Invoices and receipts are made and sent automatically · numbers run in order · GST 18% on placement fees · ₹499 registration fees carry no GST (decided), so they get a receipt · unpaid fees show here until the bank confirms them
      </Note>
    </div>
  );
}
