import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter, useDebounced } from '../../ceo/_kit/kit';
import { FormAction, Note } from '../_kit/kit';
import { approveAndPay, type RefundRow } from '../_kit/refunds';
import '../_kit/fin.css';

/**
 * Refunds — design FN-Refunds.dc.html. Refunds the rules say are owed and who
 * may approve each one: ₹499 refunds the system marks eligible and business
 * refunds within Finance's limit are approved and paid here; above the limit,
 * outside the rules, or anything Finance is unsure of goes to the CEO
 * (C-Refunds). Every check runs on the existing approve endpoints.
 */
interface Response {
  rows: RefundRow[];
  summary: { withinLimitCount: number; toPayPaise: number; withCeoCount: number; withCeoPaise: number; paidThisMonthPaise: number; paidThisMonthCount: number; businessRefundLimitPaise: number };
}

function approvalPill(r: RefundRow) {
  if (r.approval === 'within_limit') return <StatusPill tone={r.state === 'failed' ? 'crit' : 'good'}>{r.state === 'failed' ? 'Failed at the bank' : r.approvalText}</StatusPill>;
  return <StatusPill tone="warn">{r.approvalText}</StatusPill>;
}

function Actions({ r, to }: { r: RefundRow; to: ReturnType<typeof useScreenPath> }) {
  const open = (
    <Link className="btn2 lb-btn" to={to('FN-Refund', { id: r.ref })}>
      Open
    </Link>
  );
  if (r.approval === 'with_ceo') return <span className="fin-row-actions"><StatusPill tone="muted">With the CEO</StatusPill>{open}</span>;
  if (r.state === 'failed') return <span className="fin-row-actions"><Link className="btn2 lb-btn" to={to('FN-Payouts')}>Retry on Payouts</Link></span>;
  if (r.kind === 'job_seeker' && r.approval === 'within_limit' && (r.state === 'due' || r.state === 'to_pay')) {
    return (
      <span className="fin-row-actions">
        <FormAction
          label="Approve and pay"
          variant="success"
          size="compact"
          title={`Refund ${formatINR(r.amountPaise)} to ${r.subject.name ?? r.subject.code ?? ''}`}
          description={`${r.why} · ${r.check.text}. Send ${formatINR(r.amountPaise)} from the company UPI app to their UPI ID, check the name the app shows, then record the UTR.`}
          confirmLabel="Approve and record payment"
          fields={[
            { name: 'receiverNameShown', kind: 'text', label: 'Name the UPI app showed', required: true },
            { name: 'utr', kind: 'text', label: 'UTR from the bank or UPI app', required: true, placeholder: '12-digit UTR', inputMode: 'numeric' },
          ]}
          run={(v) => approveAndPay(r, { utr: String(v.utr), receiverNameShown: String(v.receiverNameShown) })}
          success={(res) => ((res as { sentToCeo: boolean }).sentToCeo ? 'Sent to the CEO' : 'Refund paid and recorded')}
        />
        {open}
      </span>
    );
  }
  return <span className="fin-row-actions">{open}</span>;
}

export default function Refunds() {
  const to = useScreenPath();
  const [who, setWho] = useState('');
  const [approval, setApproval] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const query = useQuery({
    queryKey: ['finance', 'refunds', who, approval, q],
    queryFn: () => api.get<Response>('/finance/refunds', { query: { who, approval, search: q } }),
    placeholderData: keepPreviousData,
  });
  const s = query.data?.summary;
  const loading = query.isPending;
  const columns = useMemo<Column<RefundRow>[]>(
    () => [
      {
        key: 'who',
        header: 'Who',
        cell: (r) => (
          <>
            <span className="fin-strong">
              {r.kind === 'business' ? (r.placement?.code ?? r.subject.code) : r.subject.code} · {r.subject.name ?? '—'}
            </span>
            <span className="fin-sub">{r.kind === 'business' ? 'Business' : 'Job seeker'}</span>
          </>
        ),
        csv: (r) => `${r.subject.code ?? ''} ${r.subject.name ?? ''}`,
        sortValue: (r) => r.subject.name ?? '',
      },
      { key: 'refund', header: 'Refund', cell: (r) => `${formatINR(r.amountPaise)} · ${r.why}`, csv: (r) => r.amountPaise / 100, sortValue: (r) => r.amountPaise },
      { key: 'checks', header: 'Checks', cell: (r) => <span className={r.check.eligible ? 'fin-good' : 'fin-crit'}>{r.check.text}</span>, csv: (r) => r.check.text, hideOnPhone: true },
      {
        key: 'approval',
        header: 'Approval',
        cell: (r) => (
          <>
            {approvalPill(r)}
            <Actions r={r} to={to} />
          </>
        ),
        csv: (r) => r.approvalText,
      },
    ],
    [to],
  );
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('FN-Home'), label: 'Money today' }} title="Refunds" subtitle="Refunds the rules say are owed, and who may approve each one." showSearch={false} />
      <StatGrid>
        <StatTile label="Within your limit" value={s?.withinLimitCount ?? '—'} tone="good" loading={loading} />
        <StatTile label="To pay" value={s ? formatINR(s.toPayPaise) : '—'} tone="royal" loading={loading} />
        <StatTile label={`With the CEO · ${s ? formatINR(s.withCeoPaise) : '—'}`} value={s?.withCeoCount ?? '—'} tone="gold" loading={loading} />
        <StatTile label="Paid this month" value={s ? formatINR(s.paidThisMonthPaise) : '—'} tone="cyan" loading={loading} />
      </StatGrid>
      <FilterPanel>
        <SelectFilter label="Who" value={who} onChange={setWho} options={[{ value: '', label: 'Everyone' }, { value: 'job_seeker', label: 'Job seekers' }, { value: 'business', label: 'Businesses' }]} />
        <SelectFilter label="Approval" value={approval} onChange={setApproval} options={[{ value: '', label: 'All' }, { value: 'within_limit', label: 'Within your limit' }, { value: 'needs_ceo', label: 'Needs the CEO' }]} />
        <SearchField value={search} onChange={setSearch} placeholder="Name or code" />
      </FilterPanel>
      <Card flush>
        <DataTable
          columns={columns}
          rows={query.data?.rows}
          rowKey={(r) => r.ref}
          caption="Refunds"
          loading={loading}
          error={query.error}
          onRetry={() => void query.refetch()}
          pageSize={50}
          download="refunds"
          emptyTitle="No rows match these filters. Change a filter to see more."
        />
      </Card>
      <Note>
        The system checks every refund against the rules first · you approve and pay within your limit · above {s ? formatINR(s.businessRefundLimitPaise) : 'your limit'}, outside the rules, or anything you are unsure of goes to the CEO · paying means sending from the company account and recording the UTR · pay within 7 days of approval
      </Note>
    </div>
  );
}
