import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDayMonthIST, formatTimeIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter, useDebounced } from '../../ceo/_kit/kit';
import { FormAction, Note } from '../_kit/kit';
import { ReturnMoney } from '../_kit/ReturnMoney';
import '../_kit/fin.css';

/**
 * Money in — design FN-MoneyIn.dc.html (guide: How money is collected; tax
 * handling). Every payment into the bank, matched to what it was for. A
 * placement fee short by the business's TDS is recorded as TDS, not a
 * mismatch (POST /payments/:id/confirm with tdsDeductedPaise).
 */
export interface MoneyInRow {
  id: string;
  kind: 'bank_credit' | 'card';
  at: string;
  utr: string | null;
  payerName: string | null;
  payerVpaMasked: string | null;
  remark: string | null;
  for: { paymentId: string; paymentCode: string; type: string; invoiceCode: string | null; placementCode: string | null; who: { code: string; name: string } | null } | null;
  expectedPaise: number | null;
  receivedPaise: number;
  status: 'matched_auto' | 'matched_finance' | 'tds_recorded' | 'less' | 'wrong_amount' | 'not_matched' | 'duplicate' | 'returned' | 'ignored';
  shortByPaise: number | null;
  tds: { id: string; amountPaise: number; status: string } | null;
  returnedUtr: string | null;
  duplicateRefund: { paymentId: string; status: string } | null;
}
interface Response {
  rows: MoneyInRow[];
  summary: { receivedPaise: number; receivedCount: number; matchedAutoCount: number; needYouCount: number; tdsThisMonthPaise: number };
}

const TYPE: Record<string, string> = { placement_fee: 'Placement fee', activation: 'Registration fee', reactivation: 'Registration fee (again)' };

function statusText(r: MoneyInRow): { tone: 'good' | 'warn' | 'crit' | 'info' | 'muted'; text: string } {
  switch (r.status) {
    case 'matched_auto':
      return { tone: 'good', text: 'Matched automatically' };
    case 'matched_finance':
      return { tone: 'good', text: 'Matched by Finance' };
    case 'tds_recorded':
      return { tone: 'good', text: `TDS ${r.tds ? formatINR(r.tds.amountPaise) : ''} recorded` };
    case 'less':
      return { tone: 'warn', text: `${r.shortByPaise ? formatINR(r.shortByPaise) : ''} less · TDS by the business?` };
    case 'wrong_amount':
      return { tone: 'crit', text: `Wrong amount${r.shortByPaise ? ` · ${formatINR(r.shortByPaise)} less` : ''}` };
    case 'not_matched':
      return { tone: 'crit', text: 'Not matched' };
    case 'duplicate':
      return { tone: 'warn', text: `Duplicate · refund ${formatINR(r.receivedPaise)}` };
    case 'returned':
      return { tone: 'muted', text: `Returned · UTR ${r.returnedUtr ?? ''}` };
    default:
      return { tone: 'muted', text: 'Set aside' };
  }
}

function fromText(r: MoneyInRow): string {
  if (r.for?.who && r.status !== 'not_matched') return r.for.type === 'placement_fee' ? r.for.who.name : `${r.for.who.code} · ${r.for.who.name}`;
  if (r.kind === 'card') return 'Card payment';
  return r.payerName ? `${r.payerName}${r.payerVpaMasked ? ` · ${r.payerVpaMasked}` : ''}` : `Unknown UPI ID${r.payerVpaMasked ? ` · ${r.payerVpaMasked}` : ''}`;
}

function forText(r: MoneyInRow): string {
  if (!r.for) return r.remark ? `Note: ${r.remark}` : 'No reference';
  return `${TYPE[r.for.type] ?? r.for.type}${r.for.invoiceCode ? ` · ${r.for.invoiceCode}` : r.for.placementCode ? ` · ${r.for.placementCode}` : ''}`;
}

function Actions({ r }: { r: MoneyInRow }) {
  const to = useScreenPath();
  const ask =
    r.for && (r.status === 'less' || r.status === 'wrong_amount') ? (
      <FormAction
        label="Ask the business"
        size="compact"
        title="Ask the business for the rest"
        description={`The payment link for ${r.for.paymentCode} is sent again by SMS and WhatsApp, with the full amount.`}
        run={() => api.post(`/payments/${r.for!.paymentId}/resend`)}
        success="Payment link sent again"
      />
    ) : null;
  if (r.status === 'less' && r.for) {
    return (
      <span className="fin-row-actions">
        <FormAction
          label="Record as TDS"
          variant="success"
          size="compact"
          title={`Record ${formatINR(r.shortByPaise ?? 0)} as TDS deducted`}
          description="The fee is counted as paid in full; the TDS certificate is then collected from the business (shown on Invoices). The TDS rate is confirmed with the CA."
          fields={[{ name: 'tdsNote', kind: 'text', label: 'TDS section or note from the business', required: true, placeholder: 'e.g. 194J, certificate to follow' }]}
          run={(v) => api.post(`/payments/${r.for!.paymentId}/confirm`, { bankCreditId: r.id, tdsDeductedPaise: r.shortByPaise, tdsNote: v.tdsNote })}
          success="Recorded as TDS deducted"
        />
        {ask}
      </span>
    );
  }
  if (r.status === 'wrong_amount') return <span className="fin-row-actions">{ask}</span>;
  if (r.status === 'not_matched') {
    return (
      <span className="fin-row-actions">
        <ButtonLink size="compact" to={`${to('FN-Match')}?credit=${encodeURIComponent(r.id)}`}>
          Match
        </ButtonLink>
        <ReturnMoney id={r.id} amountPaise={r.receivedPaise} to={r.payerVpaMasked} />
      </span>
    );
  }
  if (r.status === 'duplicate' && r.duplicateRefund && r.duplicateRefund.status !== 'succeeded') {
    return (
      <span className="fin-row-actions">
        <ButtonLink size="compact" variant="primary" to={`${to('FN-Payouts')}?who=refunds`}>
          Refund the extra {formatINR(r.receivedPaise)}
        </ButtonLink>
      </span>
    );
  }
  return null;
}


export default function MoneyIn() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const query = useQuery({
    queryKey: ['finance', 'money-in', period, status, type, q],
    queryFn: () => api.get<Response>('/finance/money-in', { query: { ...periodToUtcRange(period), status, type, search: q } }),
    placeholderData: keepPreviousData,
  });
  const s = query.data?.summary;
  const loading = query.isPending;
  const columns = useMemo<Column<MoneyInRow>[]>(
    () => [
      { key: 'when', header: 'When', cell: (r) => `${formatDayMonthIST(r.at)} ${formatTimeIST(r.at)}`, csv: (r) => r.at, sortValue: (r) => r.at },
      { key: 'from', header: 'From', cell: fromText, csv: fromText },
      { key: 'for', header: 'For', cell: forText, csv: forText, hideOnPhone: true },
      { key: 'expected', header: 'Expected', cell: (r) => (r.expectedPaise === null ? '—' : formatINR(r.expectedPaise)), csv: (r) => (r.expectedPaise === null ? '' : r.expectedPaise / 100), hideOnPhone: true },
      { key: 'received', header: 'Received', cell: (r) => formatINR(r.receivedPaise), csv: (r) => r.receivedPaise / 100, sortValue: (r) => r.receivedPaise },
      {
        key: 'status',
        header: 'Status',
        cell: (r) => {
          const st = statusText(r);
          return (
            <>
              <StatusPill tone={st.tone}>{st.text}</StatusPill>
              <Actions r={r} />
            </>
          );
        },
        csv: (r) => statusText(r).text,
      },
    ],
    [],
  );
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('FN-Home'), label: 'Money today' }}
        title="Money in"
        subtitle={`Every payment into the bank, matched to what it was for. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={setPeriod}
        showSearch={false}
      />
      <StatGrid>
        <StatTile label="Received" value={s ? formatINR(s.receivedPaise) : '—'} tone="good" loading={loading} detail={s ? `${s.receivedCount} payments` : undefined} />
        <StatTile label="Matched automatically" value={s?.matchedAutoCount ?? '—'} tone="royal" loading={loading} />
        <StatTile label="Need you" value={s?.needYouCount ?? '—'} tone="red" loading={loading} />
        <StatTile label="TDS taken by businesses (this month)" value={s ? formatINR(s.tdsThisMonthPaise) : '—'} tone="gold" loading={loading} to={`${to('FN-Invoices')}?status=tds_due`} />
      </StatGrid>
      <FilterPanel>
        <SelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'matched_auto', label: 'Matched automatically' },
            { value: 'matched', label: 'Matched (any)' },
            { value: 'needs', label: 'Need you' },
            { value: 'less', label: 'Less' },
            { value: 'not_matched', label: 'Not matched' },
            { value: 'duplicate', label: 'Duplicate' },
            { value: 'returned', label: 'Returned' },
          ]}
        />
        <SelectFilter
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: '', label: 'All types' },
            { value: 'placement_fee', label: 'Placement fee' },
            { value: 'activation', label: 'Registration fee' },
          ]}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Name, invoice, UTR or UPI ID" />
      </FilterPanel>
      <Card flush>
        <DataTable
          columns={columns}
          rows={query.data?.rows}
          rowKey={(r) => `${r.kind}-${r.id}`}
          caption="Money in"
          loading={loading}
          error={query.error}
          onRetry={() => void query.refetch()}
          pageSize={50}
          download="money-in"
          emptyTitle="No rows match these filters. Change a filter to see more."
        />
      </Card>
      <Note>
        The bank tells us about every payment the moment it lands · matching by reference is automatic · money only counts when it is in the bank, never by screenshot · a placement fee that arrives short is offered as TDS, not a mismatch
      </Note>
    </div>
  );
}
