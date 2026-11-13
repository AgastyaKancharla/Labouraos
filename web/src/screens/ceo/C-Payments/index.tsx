import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/Card';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { formatDateTimeIST } from '../../../lib/format/date';
import { formatINR, formatINRCompact } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, Kv, PagedTable, SearchField, SelectFilter, rangeQuery, useCeoList, useDebounced } from '../_kit/kit';
import { PAYMENT_TYPE } from '../_kit/labels';
import { PaymentTabs } from '../_kit/tabs';

/** Payments · money in — design C-Payments.dc.html. */
interface Row {
  id: string;
  code: string;
  at: string;
  amountPaise: number;
  type: string;
  method: string;
  reference: string | null;
  confirmedBy: string | null;
  jobSeeker: { id: string; code: string; name: string } | null;
  business: { id: string; code: string; name: string } | null;
  placement: { id: string; code: string } | null;
}
interface Totals {
  activationPaise: number;
  activationCount: number;
  placementFeePaise: number;
  placementCount: number;
  gstPaise: number;
  refundsPaidPaise: number;
  netPaise: number;
  bypassChargePaise?: number;
  bypassChargeCount?: number;
}
interface Extra {
  byType: Totals;
  unmatched: { id: string; utr: string; amountPaise: number; at: string; payerName: string | null }[];
  unpaidFees: { withinDue: { id: string; code: string; business: string; amountPaise: number }[]; overdue: { id: string; code: string; business: string; amountPaise: number }[] };
}
interface Summary {
  receivedInclGstPaise: number;
  matched: number;
  unmatchedCredits: number;
  amountMismatches: number;
  duplicatesToRefund: number;
}

const MATCH: Record<string, string> = { bank_feed: 'Matched automatically', gateway: 'Card · gateway', finance_manual: 'Matched by Finance' };

function forWhom(r: Row) {
  if (r.placement && r.business) return `${r.business.name} · ${r.placement.code}`;
  if (r.jobSeeker) return `${r.jobSeeker.name} · ${r.jobSeeker.code}`;
  return r.business?.name ?? '—';
}

export default function PaymentsIn() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const q = useDebounced(search);
  const list = useCeoList<Row, Extra, Summary>('/ceo/payments/in', { search: q, type, ...rangeQuery(period) });
  const d = list.query.data;
  const s = d?.summary;
  const loading = list.query.isPending;
  const t = d?.byType;
  const sum = (rows: { amountPaise: number }[]) => rows.reduce((a, r) => a + r.amountPaise, 0);

  const columns: Column<Row>[] = [
    { key: 'at', header: 'When', cell: (r) => formatDateTimeIST(r.at), csv: (r) => r.at },
    { key: 'amount', header: 'Amount', cell: (r) => formatINR(r.amountPaise), csv: (r) => r.amountPaise / 100, align: 'right' },
    { key: 'type', header: 'What', cell: (r) => PAYMENT_TYPE[r.type] ?? r.type, csv: (r) => PAYMENT_TYPE[r.type] ?? r.type, hideOnPhone: true },
    { key: 'how', header: 'How', cell: (r) => `${r.method === 'gateway_card' ? 'Card' : 'UPI'}${r.reference ? ` · ref ${r.reference.slice(0, 6)}…` : ''}`, csv: (r) => r.reference, hideOnPhone: true },
    {
      key: 'for',
      header: 'For',
      cell: (r) =>
        r.placement ? (
          <Link to={to('C-Placement', { id: r.placement.id })}>{forWhom(r)}</Link>
        ) : r.jobSeeker ? (
          <Link to={to('C-JobSeeker', { id: r.jobSeeker.id })}>{forWhom(r)}</Link>
        ) : (
          forWhom(r)
        ),
      csv: forWhom,
    },
    { key: 'match', header: 'Match', cell: (r) => <StatusPill tone="good">{MATCH[r.confirmedBy ?? ''] ?? 'Matched'}</StatusPill>, csv: (r) => r.confirmedBy },
  ];

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Payments"
        subtitle={`Every rupee in and out, matched to the person or placement it belongs to. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={setPeriod}
      />
      <PaymentTabs />
      <StatGrid>
        <StatTile label="Received incl. GST" value={s ? formatINRCompact(s.receivedInclGstPaise) : '—'} tone="gold" loading={loading} />
        <StatTile label="Matched to a record" value={s?.matched ?? '—'} tone="good" loading={loading} />
        <StatTile label="Unmatched bank credits" value={s?.unmatchedCredits ?? '—'} tone="orange" loading={loading} />
        <StatTile label="Amount mismatch" value={s?.amountMismatches ?? '—'} tone="red" loading={loading} />
        <StatTile label="Duplicate to refund" value={s?.duplicatesToRefund ?? '—'} tone="royal" loading={loading} to={to('C-Payments-Out')} />
      </StatGrid>
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Name, PAY- code, UTR or UPI ref" />
        <SelectFilter
          label="What"
          value={type}
          onChange={setType}
          options={[
            { value: '', label: 'All money in' },
            { value: 'activation', label: '₹499 registration' },
            { value: 'reactivation', label: '₹499 re-registration' },
            { value: 'placement_fee', label: 'Placement fee' },
            { value: 'bypass_charge', label: 'No-bypass charge' },
          ]}
        />
      </FilterPanel>
      <PagedTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Money in"
        download="payments-money-in"
        emptyTitle="No money received in this period."
        note="Money comes straight to Laboura's UPI and bank account. Finance matches anything the bank feed couldn't match on its own; nobody can mark a payment as paid by hand."
      />
      <div className="two-col">
        <Card title={`By type · ${periodRangeLabel(period)}`}>
          <Kv
            rows={[
              [`Activation fees (${t?.activationCount ?? 0})`, t ? formatINR(t.activationPaise) : '—'],
              [`Placement fees (${t?.placementCount ?? 0})`, t ? formatINR(t.placementFeePaise) : '—'],
              ...((t?.bypassChargeCount ?? 0) > 0 ? [[`No-bypass charges (${t?.bypassChargeCount ?? 0})`, formatINR(t?.bypassChargePaise ?? 0)] as [string, string]] : []),
              [(t?.bypassChargeCount ?? 0) > 0 ? 'GST on fees and charges' : 'GST on placement fees', t ? formatINR(t.gstPaise) : '—'],
              ['Refunds paid', t ? `− ${formatINR(t.refundsPaidPaise)}` : '—'],
              ['Net revenue (ex-GST)', t ? <b>{formatINR(t.netPaise)}</b> : '—'],
            ]}
          />
        </Card>
        <Card title="Unpaid fees (selected, not yet paid)">
          <Kv
            rows={[
              ['Within 24 hours', d ? `${d.unpaidFees.withinDue.length} · ${formatINR(sum(d.unpaidFees.withinDue))}` : '—'],
              [
                'Overdue',
                d && d.unpaidFees.overdue.length ? (
                  <StatusPill tone="crit">{`${d.unpaidFees.overdue.length} · ${d.unpaidFees.overdue.map((o) => o.business).slice(0, 2).join(', ')} · ${formatINR(sum(d.unpaidFees.overdue))}`}</StatusPill>
                ) : (
                  'None'
                ),
              ],
              ['Joining dates held back', 'Until paid'],
              ['Unmatched bank credits', d ? (d.unmatched.length ? `${d.unmatched.length} · ${formatINR(sum(d.unmatched))} — Finance matches them` : 'None') : '—'],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
