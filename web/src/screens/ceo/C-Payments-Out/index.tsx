import { useState } from 'react';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatINR } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { FilterPanel, PagedTable, SelectFilter, rangeQuery, useCeoList } from '../_kit/kit';
import { PAYMENT_STATUS, PAYMENT_TYPE } from '../_kit/labels';
import { PaymentTabs } from '../_kit/tabs';

/** Payments · money out — design C-Payments-Out.dc.html: owed → approved → paid. */
interface Row {
  id: string;
  code: string;
  type: string;
  amountPaise: number;
  status: string;
  withCeo: boolean;
  approvedBy: { id: string; name: string; role: string } | null;
  paidAt: string | null;
  utr: string | null;
  to: { id: string; code: string; name: string } | null;
  toKind: string | null;
  placement: { id: string; code: string } | null;
}
interface Summary {
  refundsPaidPaise: number;
  refundsWithCeoPaise: number;
  refundsWithCeoCount: number;
  referralDuePaise: number;
  referralDueCount: number;
  rewardDuePaise: number;
  rewardDueCount: number;
  failedCount: number;
}

function approvedBy(r: Row) {
  if (r.withCeo) return 'Needs you';
  if (!r.approvedBy) return '—';
  return r.approvedBy.role === 'finance' ? `Finance (within limit) · ${r.approvedBy.name}` : r.approvedBy.name;
}

function RowAction({ r }: { r: Row }) {
  if (r.status !== 'pending') return <span className="ceo-sub">{r.utr ? `UTR ${r.utr}` : '—'}</span>;
  return (
    <span className="ceo-actions" onClick={(e) => e.stopPropagation()}>
      <ActionButton label="Approve" variant="success" title={`Approve ${PAYMENT_TYPE[r.type] ?? r.type} ${formatINR(r.amountPaise)}`} description="Finance then pays it and records the UTR." run={() => api.post(`/payments/${r.id}/approve`)} success="Approved — Finance pays it" />
      {r.withCeo && <ActionButton label="Reject" variant="danger" title="Reject the refund" reason run={({ reason }) => api.post(`/payments/${r.id}/reject-refund`, { reason })} success="Refund rejected" />}
    </span>
  );
}

export default function PaymentsOut() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const list = useCeoList<Row, object, Summary>('/ceo/payments/out', { type, status, ...rangeQuery(period) });
  const s = list.query.data?.summary;
  const loading = list.query.isPending;
  const columns: Column<Row>[] = [
    { key: 'type', header: 'Type', cell: (r) => PAYMENT_TYPE[r.type] ?? r.type, csv: (r) => PAYMENT_TYPE[r.type] ?? r.type },
    { key: 'to', header: 'To', cell: (r) => (r.to ? `${r.to.name} · ${r.to.code}` : '—'), csv: (r) => (r.to ? `${r.to.code} ${r.to.name}` : '') },
    { key: 'amount', header: 'Amount', cell: (r) => formatINR(r.amountPaise), csv: (r) => r.amountPaise / 100, align: 'right' },
    { key: 'by', header: 'Approved by', cell: approvedBy, csv: approvedBy, hideOnPhone: true },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusPill tone={r.withCeo ? 'crit' : (PAYMENT_STATUS[r.status]?.tone ?? 'muted')}>{r.withCeo ? 'Waiting for you' : (PAYMENT_STATUS[r.status]?.label ?? r.status)}</StatusPill>,
      csv: (r) => r.status,
    },
    { key: 'act', header: '', cell: (r) => <RowAction r={r} />, csv: (r) => r.utr },
  ];
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Payments"
        subtitle={`Money going out: refunds, referral payouts and joining rewards. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={setPeriod}
      />
      <PaymentTabs />
      <StatGrid>
        <StatTile label="Refunds paid in the period" value={s ? formatINR(s.refundsPaidPaise) : '—'} tone="royal" loading={loading} />
        <StatTile label={`Refunds waiting for you · ${s?.refundsWithCeoCount ?? 0}`} value={s ? formatINR(s.refundsWithCeoPaise) : '—'} tone="orange" loading={loading} to={to('C-Refunds')} />
        <StatTile label={`Referral payouts due · ${s?.referralDueCount ?? 0}`} value={s ? formatINR(s.referralDuePaise) : '—'} tone="gold" loading={loading} />
        <StatTile label={`Joining rewards due · ${s?.rewardDueCount ?? 0}`} value={s ? formatINR(s.rewardDuePaise) : '—'} tone="cyan" loading={loading} />
        <StatTile label="Failed payouts" value={s?.failedCount ?? '—'} tone="red" loading={loading} />
      </StatGrid>
      <FilterPanel>
        <SelectFilter
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: '', label: 'All money out' },
            { value: 'refund', label: 'Refunds' },
            { value: 'duplicate_refund', label: 'Duplicate payment refunds' },
            { value: 'referral_payout', label: 'Referral payouts' },
            { value: 'joining_reward', label: 'Joining rewards' },
          ]}
        />
        <SelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'Open, and everything in the period' },
            { value: 'due', label: 'Owed or approved, not paid' },
            { value: 'failed', label: 'Failed' },
            { value: 'paid', label: 'Paid in the period' },
          ]}
        />
      </FilterPanel>
      <PagedTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Money out"
        download="payments-money-out"
        emptyTitle="Nothing owed or paid in this period."
        note="Money goes out as owed → approved → paid. Finance approves and pays refunds within its limits (₹499 job seeker refunds, business refunds up to ₹15,000); above that or outside the rules, you approve first. Payouts and rewards are paid by Finance every day once due, with the UTR recorded."
      />
    </div>
  );
}
