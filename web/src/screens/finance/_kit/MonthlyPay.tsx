import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { FormAction } from './kit';
import { STAFF_ROLE, monthName } from './payroll';

interface StaffSalaryRow {
  staffId: string;
  staffCode: string;
  name: string;
  role: string;
  joinedAt: string;
  joinedOn: string | null;
  monthlyPaise: number | null;
  effectiveFromMonth: string | null;
  upcoming: { monthlyPaise: number; effectiveFromMonth: string } | null;
  history: { monthlyPaise: number; effectiveFromMonth: string; note: string | null; setBy: string | null; setAt: string }[];
}

/**
 * Monthly pay per person (GET /finance/staff-salaries). Only the CEO sets or
 * changes a salary (owner decision 11 Nov): `canEdit` on the CEO's Salaries
 * page; Finance sees the same list read-only.
 */
export function MonthlyPay({ months, canEdit }: { months: string[]; canEdit: boolean }) {
  const query = useQuery({ queryKey: ['finance', 'staff-salaries'], queryFn: () => api.get<{ month: string; rows: StaffSalaryRow[] }>('/finance/staff-salaries') });
  const columns = useMemo<Column<StaffSalaryRow>[]>(() => {
    const cols: Column<StaffSalaryRow>[] = [
      { key: 'name', header: 'Name', cell: (r) => <><span className="fin-strong">{r.name}</span><span className="fin-sub">{r.staffCode}</span></>, csv: (r) => r.name, sortValue: (r) => r.name, filter: 'text', filterValue: (r) => `${r.name} ${r.staffCode}` },
      { key: 'role', header: 'Role', cell: (r) => STAFF_ROLE[r.role] ?? r.role, csv: (r) => STAFF_ROLE[r.role] ?? r.role },
      { key: 'joined', header: 'Joined', cell: (r) => (r.joinedOn ? formatDateIST(`${r.joinedOn}T00:00:00+05:30`) : <span className="fin-sub">First login</span>), csv: (r) => r.joinedOn, hideOnPhone: true },
      { key: 'pay', header: 'Monthly pay', cell: (r) => (r.monthlyPaise === null ? <StatusPill tone="warn">Not set</StatusPill> : formatINR(r.monthlyPaise)), csv: (r) => (r.monthlyPaise === null ? '' : r.monthlyPaise / 100), sortValue: (r) => r.monthlyPaise ?? -1 },
      { key: 'from', header: 'From', cell: (r) => (r.effectiveFromMonth ? monthName(r.effectiveFromMonth, true) : '—'), csv: (r) => r.effectiveFromMonth, hideOnPhone: true },
      { key: 'next', header: 'Change coming', cell: (r) => (r.upcoming ? `${formatINR(r.upcoming.monthlyPaise)} from ${monthName(r.upcoming.effectiveFromMonth, true)}` : '—'), hideOnPhone: true },
    ];
    if (canEdit) {
      cols.push({
        key: 'set',
        header: '',
        cell: (r) => (
          <FormAction
            label={r.monthlyPaise === null ? 'Set pay' : 'Change pay'}
            size="compact"
            title={`Monthly pay · ${r.name}`}
            description="A fixed monthly salary — no commission for anyone. A day's pay is this ÷ 26. It applies from the month you choose; a month you already approved can't change."
            fields={[
              { name: 'monthlyPaise', kind: 'money', label: 'Monthly pay', required: true, initial: r.monthlyPaise },
              { name: 'effectiveFromMonth', kind: 'select', label: 'From', options: months.map((m) => ({ value: m, label: monthName(m, true) })) },
              { name: 'note', kind: 'text', label: 'Note (optional)', placeholder: 'Joining salary, raise…' },
            ]}
            run={(v) => api.put(`/finance/staff-salaries/${r.staffId}`, { monthlyPaise: v.monthlyPaise, effectiveFromMonth: v.effectiveFromMonth, note: v.note || undefined })}
            success={`Pay saved for ${r.name}`}
          />
        ),
      });
    }
    return cols;
  }, [months, canEdit]);
  return (
    <Card title="Monthly pay per person" aside={<span className="fin-sub">{canEdit ? 'Only you set salaries · Finance sees them' : 'Set by the CEO · only the CEO and Finance see salaries'}</span>} flush>
      <DataTable columns={columns} rows={query.data?.rows} rowKey={(r) => r.staffId} caption="Monthly pay per person" loading={query.isPending} error={query.error} onRetry={() => void query.refetch()} pageSize={25} download="monthly-pay" emptyTitle="Nobody on the staff yet." />
    </Card>
  );
}
