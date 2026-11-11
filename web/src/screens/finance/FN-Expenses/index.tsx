import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useAuth } from '../../../auth/AuthProvider';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter, useDebounced } from '../../ceo/_kit/kit';
import { Note } from '../_kit/kit';
import { AddBill, BillLink, ExpenseActions, approvalText, type ExpenseRow, type ExpensesResponse } from '../_kit/expenses';
import { CHANNEL, EXPENSE_CATEGORY, EXPENSE_CATEGORY_OPTIONS, roleLabel } from '../_kit/labels';
import '../_kit/fin.css';

/**
 * Expenses & bills — design FN-Expenses.dc.html (guide: Expenses, decided 9
 * Nov; approval limits). Every bill with its proof and who approved it.
 * Finance approves up to its limit; above it the CEO. No bill, no payment.
 */
export default function Expenses() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const { session } = useAuth();
  const role = session?.staff.role;
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const query = useQuery({
    queryKey: ['finance', 'expenses', period, category, status, q],
    queryFn: () => api.get<ExpensesResponse>('/finance/expenses', { query: { ...periodToUtcRange(period), category, status, search: q } }),
    placeholderData: keepPreviousData,
  });
  const s = query.data?.summary;
  const limit = s?.limitPaise ?? 1000000;
  const loading = query.isPending;
  const columns = useMemo<Column<ExpenseRow>[]>(
    () => [
      { key: 'date', header: 'Date', cell: (r) => formatDateIST(r.billDate), csv: (r) => formatDateIST(r.billDate), sortValue: (r) => r.billDate },
      { key: 'category', header: 'Category', cell: (r) => EXPENSE_CATEGORY[r.category] ?? r.category, csv: (r) => EXPENSE_CATEGORY[r.category] ?? r.category, hideOnPhone: true },
      {
        key: 'what',
        header: 'What',
        cell: (r) => (
          <>
            {r.supplier} · {r.description}
            {r.adChannel && ` · channel: ${CHANNEL[r.adChannel] ?? r.adChannel}`}
            {r.enteredBy && <span className="fin-sub">Added by {r.enteredBy.name} ({roleLabel(r.enteredBy.role)})</span>}
          </>
        ),
        csv: (r) => `${r.supplier} · ${r.description}`,
      },
      { key: 'amount', header: 'Amount', cell: (r) => formatINR(r.amountPaise), csv: (r) => r.amountPaise / 100, sortValue: (r) => r.amountPaise },
      { key: 'proof', header: 'Proof', cell: (r) => <BillLink r={r} />, csv: (r) => (r.hasBill ? 'Bill attached' : 'No bill') },
      {
        key: 'approval',
        header: 'Approval',
        cell: (r) => (
          <>
            <StatusPill tone={r.status === 'paid' ? 'good' : r.status === 'rejected' ? 'crit' : r.status === 'waiting_ceo' ? 'info' : 'warn'}>{approvalText(r, limit)}</StatusPill>
            <ExpenseActions r={r} role={role} limitPaise={limit} />
          </>
        ),
        csv: (r) => approvalText(r, limit),
      },
    ],
    [limit, role],
  );
  const prefill = params.get('prefill') === 'bank-charges' ? { category: 'office_other', supplier: 'Bank', description: 'Bank charges' } : undefined;
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('FN-Home'), label: 'Money today' }}
        title="Expenses & bills"
        subtitle={`Every bill, with its proof and who approved it. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={setPeriod}
        showSearch={false}
      />
      <StatGrid>
        <StatTile label="Spent in the period" value={s ? formatINR(s.spentPaise) : '—'} tone="royal" loading={loading} detail={s && s.autoPaise ? `incl. ${formatINR(s.autoPaise)} payouts & rewards (automatic)` : undefined} />
        <StatTile label="Budget for the period" value={s ? formatINR(s.budgetPaise) : '—'} tone="cyan" loading={loading} />
        <StatTile label="To pay" value={s?.toPayCount ?? '—'} tone="orange" loading={loading} detail={s && s.waitingCeoCount ? `${s.waitingCeoCount} with the CEO` : undefined} />
        <StatTile label="Due now" value={s ? formatINR(s.dueNowPaise) : '—'} tone="gold" loading={loading} />
      </StatGrid>
      <FilterPanel>
        <SelectFilter
          label="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: '', label: 'All' }, ...EXPENSE_CATEGORY_OPTIONS.map((c) => ({ value: c, label: EXPENSE_CATEGORY[c] }))]}
        />
        <SelectFilter
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'paid', label: 'Paid' },
            { value: 'to_pay', label: 'To pay' },
            { value: 'waiting_ceo', label: 'With the CEO' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Supplier or note" />
      </FilterPanel>
      <Card flush>
        <DataTable
          columns={columns}
          rows={query.data?.rows}
          rowKey={(r) => r.id}
          caption="Expenses and bills"
          loading={loading}
          error={query.error}
          onRetry={() => void query.refetch()}
          pageSize={50}
          download="expenses"
          emptyTitle="No rows match these filters. Change a filter to see more."
        />
      </Card>
      <Note>
        Expenses up to {formatINR(limit)} with a bill: you approve · above {formatINR(limit)}: the CEO · salaries, payouts and rewards come in automatically · refunds come off revenue, not here
        {query.data?.refundsAgainstRevenue.count ? ` (${formatINR(query.data.refundsAgainstRevenue.paise)} refunded in the period)` : ''} · no bill, no payment
      </Note>
      <AddBill key={prefill ? 'bank' : 'blank'} prefill={prefill} />
    </div>
  );
}
