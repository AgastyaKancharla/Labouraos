import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../auth/AuthProvider';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { MoneyField } from '../../../components/fields';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { canExportLists, downloadTextFile, toCsv } from '../../../lib/csv';
import { formatDateIST, formatMonthIST, istDateKey } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { AddBill, BillLink, ExpenseActions, approvalText, type ExpenseRow, type ExpensesResponse } from '../../finance/_kit/expenses';
import { CHANNEL, EXPENSE_CATEGORY, roleLabel } from '../../finance/_kit/labels';
import '../../finance/_kit/fin.css';
import '../_kit/ceo.css';

/**
 * Expenses — design C-Expenses.dc.html (guide: Expenses, decided 9 Nov). Every
 * cost of running Laboura, budget vs. actual, and the real profit or loss:
 * revenue − expenses for the period, worked out on the server (GET
 * /finance/profit). Salaries, payouts and rewards come in automatically;
 * refunds come off revenue. Expenses above Finance's limit wait for the CEO here.
 */
interface Profit {
  period: { from: string; to: string; month: string };
  revenue: { activationPaise: number; activationCount: number; placementFeePaise: number; placementCount: number; bypassChargePaise?: number; bypassChargeCount?: number; refundsPaise: number; refundsCount: number; netRevenuePaise: number; gstCollectedPaise: number };
  expenses: { billsPaise: number; payoutsPaise: number; salariesPaise: number; salariesFromPayroll: boolean; totalPaise: number };
  profitPaise: number;
  costPerPlacementPaise: number | null;
  breakEvenPlacements: number | null;
  placements: number;
  categories: { category: string; added: 'auto' | 'bill'; budgetPaise: number; actualPaise: number }[];
  budgetTotalPaise: number;
  channels: { channel: string; spentPaise: number; placed: number; perPlacementPaise: number | null }[];
  limitPaise: number;
}

const HOW_ADDED: Record<string, string> = {
  salaries: 'From payroll (auto)',
  rent: 'Monthly',
  calling: 'Bill',
  sms_whatsapp: 'Bill',
  id_checks: 'Bill',
  hosting: 'Bill',
  ads_marketing: 'Tagged by channel',
  payouts_rewards: 'Auto',
  field_travel: 'Claims with receipts',
  office_other: 'Receipts',
};

function VsBudget({ budget, actual }: { budget: number; actual: number }) {
  if (!budget) return <span className="ceo-sub">No budget</span>;
  const diff = actual - budget;
  if (diff === 0) return <StatusPill tone="info">On budget</StatusPill>;
  return <StatusPill tone={diff > 0 ? 'warn' : 'good'}>{diff > 0 ? `+${formatINR(diff)} over` : `${formatINR(-diff)} under`}</StatusPill>;
}

function SetBudgets({ month, categories }: { month: string; categories: Profit['categories'] }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, number | null>>({});
  const toast = useToast();
  const queryClient = useQueryClient();
  const start = () => {
    setValues(Object.fromEntries(categories.map((c) => [c.category, c.budgetPaise || null])));
    setOpen(true);
  };
  const save = useMutation({
    mutationFn: () => api.put('/finance/expense-budgets', { month, budgets: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v ?? 0])) }),
    onSuccess: () => {
      toast.success(`Budgets for ${formatMonthIST(`${month}-15T00:00:00Z`)} saved`);
      setOpen(false);
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the budgets'),
  });
  return (
    <>
      <Button onClick={start}>Set budgets</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Budgets for ${formatMonthIST(`${month}-15T00:00:00Z`)}`}
        width={560}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
              Save budgets
            </Button>
          </>
        }
      >
        <div className="fin-form">
          {categories.map((c) => (
            <MoneyField key={c.category} label={EXPENSE_CATEGORY[c.category] ?? c.category} value={values[c.category] ?? null} onChange={(v) => setValues((old) => ({ ...old, [c.category]: v }))} />
          ))}
        </div>
      </Modal>
    </>
  );
}

function AddExpense() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        + Add expense
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add an expense" width={720}>
        <p style={{ marginTop: 0, fontSize: 13 }}>An expense you add is approved by you. Attach the bill — no bill, no payment.</p>
        <AddBill />
      </Modal>
    </>
  );
}

export default function CeoExpenses() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const { session } = useAuth();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const range = periodToUtcRange(period);
  const profit = useQuery({ queryKey: ['finance', 'profit', period], queryFn: () => api.get<Profit>('/finance/profit', { query: range }), placeholderData: keepPreviousData });
  const entries = useQuery({ queryKey: ['finance', 'expenses', 'latest', period], queryFn: () => api.get<ExpensesResponse>('/finance/expenses', { query: range }), placeholderData: keepPreviousData });
  const p = profit.data;
  const loading = profit.isPending;
  const monthName = p ? formatMonthIST(p.period.to).split(' ')[0] : '';
  const limit = p?.limitPaise ?? entries.data?.summary.limitPaise ?? 1000000;
  const worst = p?.channels.filter((c) => c.perPlacementPaise !== null).sort((a, b) => (b.perPlacementPaise ?? 0) - (a.perPlacementPaise ?? 0))[0];
  const best = p?.channels.filter((c) => c.perPlacementPaise !== null).sort((a, b) => (a.perPlacementPaise ?? 0) - (b.perPlacementPaise ?? 0))[0];
  const downloadPnl = () => {
    if (!p) return;
    const rows: [string, number][] = [
      [`Activation fees (${p.revenue.activationCount})`, p.revenue.activationPaise],
      [`Placement fees (${p.revenue.placementCount})`, p.revenue.placementFeePaise],
      ...((p.revenue.bypassChargeCount ?? 0) > 0 ? [[`No-bypass charges (${p.revenue.bypassChargeCount})`, p.revenue.bypassChargePaise ?? 0] as [string, number]] : []),
      ['Refunds', -p.revenue.refundsPaise],
      ['Net revenue', p.revenue.netRevenuePaise],
      ...p.categories.map((c) => [`Expense · ${EXPENSE_CATEGORY[c.category] ?? c.category}`, -c.actualPaise] as [string, number]),
      ['Expenses', -p.expenses.totalPaise],
      ['Profit / loss', p.profitPaise],
      ['GST collected (not income)', p.revenue.gstCollectedPaise],
    ];
    downloadTextFile(`profit-and-loss-${istDateKey(period.from)}-${istDateKey(period.to)}.csv`, toCsv(rows, [
      { header: 'Line', value: (r) => r[0] },
      { header: 'Amount (₹)', value: (r) => r[1] / 100 },
    ]));
  };
  const entryColumns: Column<ExpenseRow>[] = [
    { key: 'date', header: 'Date', cell: (r) => formatDateIST(r.billDate), sortValue: (r) => r.billDate },
    { key: 'category', header: 'Category', cell: (r) => EXPENSE_CATEGORY[r.category] ?? r.category, hideOnPhone: true },
    { key: 'what', header: 'What', cell: (r) => `${r.supplier} · ${r.description}${r.adChannel ? ` · channel: ${CHANNEL[r.adChannel] ?? r.adChannel}` : ''}` },
    { key: 'amount', header: 'Amount', cell: (r) => formatINR(r.amountPaise), sortValue: (r) => r.amountPaise },
    { key: 'by', header: 'Added by', cell: (r) => (r.enteredBy ? `${r.enteredBy.name} (${roleLabel(r.enteredBy.role)})` : '—'), hideOnPhone: true },
    { key: 'bill', header: 'Bill', cell: (r) => <BillLink r={r} /> },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <>
          <StatusPill tone={r.status === 'paid' || r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'crit' : r.status === 'waiting_ceo' ? 'warn' : 'info'}>{approvalText(r, limit, 'ceo')}</StatusPill>
          <ExpenseActions r={r} role={session?.staff.role} limitPaise={limit} />
        </>
      ),
    },
  ];
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Expenses"
        subtitle={`Every cost of running Laboura, budget vs. actual, and the real profit or loss. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={setPeriod}
        actions={
          <>
            <AddExpense />
            {p && <SetBudgets month={p.period.month} categories={p.categories} />}
          </>
        }
      />
      {canExportLists(session?.staff.role) && (
        <div className="fin-foot" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={downloadPnl} disabled={!p}>
            Download P&amp;L (Excel)
          </Button>
        </div>
      )}
      {profit.isError ? (
        <ErrorState error={profit.error} onRetry={() => void profit.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatTile label="Net revenue (ex-GST)" value={p ? formatINR(p.revenue.netRevenuePaise) : '—'} tone="good" loading={loading} />
            <StatTile label="Expenses" value={p ? formatINR(p.expenses.totalPaise) : '—'} tone="orange" loading={loading} />
            <StatTile label={p && p.profitPaise < 0 ? 'Loss in the period' : 'Profit in the period'} value={p ? formatINR(p.profitPaise) : '—'} tone={p && p.profitPaise < 0 ? 'red' : 'good'} loading={loading} />
            <StatTile label="Cost per placement" value={p?.costPerPlacementPaise != null ? formatINR(p.costPerPlacementPaise) : '—'} tone="royal" loading={loading} />
            <StatTile label="Placements to break even" value={p?.breakEvenPlacements ?? '—'} tone="gold" loading={loading} />
            <StatTile label="Placements in the period" value={p?.placements ?? '—'} tone="cyan" loading={loading} />
          </StatGrid>
          <div className="two-col">
            <Card title={`Profit and loss${monthName ? ` · ${periodRangeLabel(period)}` : ''}`}>
              {p ? (
                <div className="fin-kv">
                  <span>
                    Activation fees ({p.revenue.activationCount})
                  </span>
                  <span>{formatINR(p.revenue.activationPaise)}</span>
                  <span>Placement fees ({p.revenue.placementCount})</span>
                  <span>{formatINR(p.revenue.placementFeePaise)}</span>
                  {(p.revenue.bypassChargeCount ?? 0) > 0 && (
                    <>
                      <span>No-bypass charges ({p.revenue.bypassChargeCount})</span>
                      <span>{formatINR(p.revenue.bypassChargePaise ?? 0)}</span>
                    </>
                  )}
                  <span>Refunds</span>
                  <span>{formatINR(-p.revenue.refundsPaise)}</span>
                  <span>Net revenue</span>
                  <span>{formatINR(p.revenue.netRevenuePaise)}</span>
                  <span>Expenses</span>
                  <span>{formatINR(-p.expenses.totalPaise)}</span>
                  <span className="fin-strong">Profit / loss</span>
                  <span className={p.profitPaise < 0 ? 'fin-crit' : 'fin-good'}>{formatINR(p.profitPaise)}</span>
                  <span>GST collected (not income)</span>
                  <span>{formatINR(p.revenue.gstCollectedPaise)} · owed to the government</span>
                </div>
              ) : (
                <SkeletonCard height={220} />
              )}
              {p && !p.expenses.salariesFromPayroll && <p className="fin-note">Salaries join automatically from payroll once it is run; none are counted yet.</p>}
            </Card>
            <Card title="Spend per channel vs. what it brought" flush>
              <DataTable
                columns={[
                  { key: 'channel', header: 'Channel', cell: (c: Profit['channels'][number]) => CHANNEL[c.channel] ?? c.channel },
                  { key: 'spent', header: 'Spent', cell: (c: Profit['channels'][number]) => formatINR(c.spentPaise) },
                  { key: 'placed', header: 'Placed', cell: (c: Profit['channels'][number]) => c.placed },
                  { key: 'per', header: 'Per placement', cell: (c: Profit['channels'][number]) => (c.perPlacementPaise === null ? '—' : formatINR(c.perPlacementPaise)) },
                ]}
                rows={p?.channels}
                rowKey={(c) => c.channel}
                caption="Spend per channel"
                loading={loading}
                pageSize={10}
                emptyTitle="No channel spend or placements in this period."
              />
              {worst && best && worst.channel !== best.channel && (
                <p className="fin-note" style={{ padding: '8px 16px 14px' }}>
                  {CHANNEL[worst.channel] ?? worst.channel} cost {formatINR(worst.perPlacementPaise ?? 0)} per placement; {CHANNEL[best.channel] ?? best.channel} {formatINR(best.perPlacementPaise ?? 0)}.
                </p>
              )}
            </Card>
          </div>
          <Card flush>
            <DataTable
              columns={[
                { key: 'category', header: 'Category', cell: (c: Profit['categories'][number]) => (c.category === 'total' ? <strong>Total</strong> : (EXPENSE_CATEGORY[c.category] ?? c.category)) },
                { key: 'how', header: "How it's added", cell: (c: Profit['categories'][number]) => (c.category === 'total' ? '' : (HOW_ADDED[c.category] ?? 'Bill')), hideOnPhone: true },
                { key: 'budget', header: 'Budget', cell: (c: Profit['categories'][number]) => formatINR(c.budgetPaise) },
                { key: 'actual', header: 'Actual', cell: (c: Profit['categories'][number]) => <strong>{formatINR(c.actualPaise)}</strong> },
                { key: 'vs', header: 'vs budget', cell: (c: Profit['categories'][number]) => <VsBudget budget={c.budgetPaise} actual={c.actualPaise} /> },
              ]}
              rows={p ? [...p.categories, { category: 'total', added: 'bill' as const, budgetPaise: p.budgetTotalPaise, actualPaise: p.expenses.totalPaise }] : undefined}
              rowKey={(c) => c.category}
              caption="Budget vs actual by category"
              loading={loading}
              pageSize={20}
            />
            <p className="fin-note" style={{ padding: '0 16px 14px' }}>
              Salaries, payouts and rewards come in automatically · everything else is entered with the bill attached · amounts over {formatINR(limit)} (set in Settings) need your approval
            </p>
          </Card>
          <Card title="Latest entries" aside={<AddExpense />} flush>
            <DataTable
              columns={entryColumns}
              rows={entries.data?.rows}
              rowKey={(r) => r.id}
              caption="Latest expense entries"
              loading={entries.isPending}
              error={entries.error}
              onRetry={() => void entries.refetch()}
              pageSize={20}
              download="expenses"
              emptyTitle="No expenses entered in this period."
            />
          </Card>
        </>
      )}
    </div>
  );
}
