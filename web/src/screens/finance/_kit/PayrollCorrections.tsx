import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { Tabs } from '../../../components/Tabs';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { FormAction } from './kit';
import { addMonths, istMonthKey, monthName } from './payroll';

export interface PayrollCorrectionRow {
  id: string;
  staffId: string;
  staffCode: string | null;
  name: string | null;
  relatesToMonth: string;
  amountPaise: number;
  reason: string;
  source: 'recompute' | 'carry_forward' | 'manual' | string;
  createdBy: string | null;
  createdAt: string;
  appliedMonth: string | null;
}

type Status = 'waiting' | 'applied';

const SOURCE: Record<string, string> = {
  manual: 'Added by the CEO',
  recompute: 'Holiday or attendance changed',
  carry_forward: 'Carried forward',
};

/**
 * Pay corrections (GET /payroll/corrections): waiting for the next salary
 * sheet, or already applied on one. Only the CEO adds one (`canAdd`, on the
 * CEO's Salaries page; POST /payroll/corrections) — for example for a month
 * payroll no longer works out again; Finance sees the same list read-only.
 */
export function PayrollCorrections({ canAdd }: { canAdd: boolean }) {
  const now = useNow();
  const [status, setStatus] = useState<Status>('waiting');
  const query = useQuery({
    queryKey: ['payroll', 'corrections', status],
    queryFn: () => api.get<{ status: Status; rows: PayrollCorrectionRow[] }>('/payroll/corrections', { query: { status } }),
  });
  const staff = useQuery({
    queryKey: ['finance', 'staff-salaries'],
    queryFn: () => api.get<{ month: string; rows: { staffId: string; staffCode: string; name: string }[] }>('/finance/staff-salaries'),
    enabled: canAdd,
  });
  const thisMonth = istMonthKey(now);
  const months = Array.from({ length: 13 }, (_, i) => addMonths(thisMonth, -(i + 1)));

  const columns = useMemo<Column<PayrollCorrectionRow>[]>(
    () => [
      { key: 'name', header: 'Name', cell: (r) => <><span className="fin-strong">{r.name ?? '—'}</span><span className="fin-sub">{r.staffCode ?? ''}</span></>, csv: (r) => r.name, sortValue: (r) => r.name ?? '', filter: 'text', filterValue: (r) => `${r.name ?? ''} ${r.staffCode ?? ''}` },
      { key: 'month', header: 'For', cell: (r) => monthName(r.relatesToMonth, true), csv: (r) => r.relatesToMonth, sortValue: (r) => r.relatesToMonth },
      {
        key: 'amount',
        header: 'Amount',
        cell: (r) => <span className="fin-strong">{r.amountPaise > 0 ? `+${formatINR(r.amountPaise)}` : `−${formatINR(-r.amountPaise)}`}</span>,
        csv: (r) => r.amountPaise / 100,
        sortValue: (r) => r.amountPaise,
        align: 'right',
      },
      { key: 'reason', header: 'Reason', cell: (r) => <><span>{r.reason}</span><span className="fin-sub">{SOURCE[r.source] ?? r.source}{r.createdBy ? ` · ${r.createdBy}` : ''} · {formatDateIST(r.createdAt)}</span></>, csv: (r) => r.reason },
      {
        key: 'state',
        header: '',
        cell: (r) => (r.appliedMonth ? <StatusPill tone="good">{`On the ${monthName(r.appliedMonth, true)} sheet`}</StatusPill> : <StatusPill tone="warn">Next sheet</StatusPill>),
        csv: (r) => r.appliedMonth ?? 'waiting',
      },
    ],
    [],
  );

  const add = canAdd ? (
    <FormAction
      label="Add a correction"
      variant="primary"
      title="Add a pay correction"
      description="Pays back (+) or takes back (−) an amount for an earlier month on the next salary sheet — for example a holiday, day or joining date in a month payroll no longer works out again. Finance pays it with that sheet."
      fields={[
        { name: 'staffId', kind: 'select', label: 'Person', required: true, options: [{ value: '', label: 'Choose a person' }, ...(staff.data?.rows ?? []).map((p) => ({ value: p.staffId, label: `${p.name} (${p.staffCode})` }))] },
        { name: 'relatesToMonth', kind: 'select', label: 'For the month', options: months.map((m) => ({ value: m, label: monthName(m, true) })) },
        { name: 'direction', kind: 'select', label: 'Pay back or take back', options: [{ value: 'pay', label: 'Pay back (+)' }, { value: 'take', label: 'Take back (−)' }] },
        { name: 'amountPaise', kind: 'money', label: 'Amount', required: true },
        { name: 'reason', kind: 'text', label: 'Reason', required: true, placeholder: 'Holiday on 14 Jan 2025 not paid' },
      ]}
      run={(v) => {
        const amount = Number(v.amountPaise ?? 0);
        return api.post('/payroll/corrections', { staffId: v.staffId, relatesToMonth: v.relatesToMonth, amountPaise: v.direction === 'take' ? -amount : amount, reason: v.reason });
      }}
      success="Correction added: the next salary sheet pays it"
    />
  ) : null;

  return (
    <Card
      title="Pay corrections"
      aside={canAdd ? add : <span className="fin-sub">Added by the CEO · the next salary sheet pays them</span>}
      flush
    >
      <div style={{ padding: '0 18px' }}>
        <Tabs<Status>
          label="Corrections"
          value={status}
          onChange={setStatus}
          items={[
            { key: 'waiting', label: 'Waiting for the next sheet' },
            { key: 'applied', label: 'Applied' },
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.rows}
        rowKey={(r) => r.id}
        caption={status === 'waiting' ? 'Pay corrections waiting for the next sheet' : 'Pay corrections applied'}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        pageSize={25}
        download="pay-corrections"
        emptyTitle={status === 'waiting' ? 'No corrections waiting.' : 'No corrections applied yet.'}
      />
    </Card>
  );
}
