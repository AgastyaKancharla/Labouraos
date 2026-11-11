import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { hm, roleLabel } from '../_kit/format';
import { TeamTabs } from '../_kit/tabs';
import { MonthPicker, previousMonthKey } from '../_kit/month';

/**
 * Salaries — design C-Team-Salaries.dc.html. The month's days straight from
 * attendance (paid days, loss of pay, shortfall). Rupee amounts come from
 * Finance's payroll (Phase 22); until it is switched on the money columns
 * say so instead of guessing.
 */
interface SheetRow {
  staffCode: string;
  name: string;
  role: string;
  workingDays: number;
  holidays: number;
  fullDays: number;
  halfDays: number;
  paidLeaveDays: number;
  absentDays: number;
  unpaidLeaveDays: number;
  paidDays: number;
  unpaidDays: number;
  deductibleShortfallMinutes: number;
}

const PENDING = 'With payroll';

export default function Salaries() {
  const to = useScreenPath();
  const now = useNow();
  const [month, setMonth] = useState(() => previousMonthKey(istDateKey(now)));
  const sheet = useQuery({
    queryKey: ['attendance', 'month-sheet', month],
    queryFn: () => api.get<{ month: string; rows: SheetRow[] }>('/attendance/month-sheet', { query: { month } }),
  });
  const rows = sheet.data?.rows;
  const lop = (rows ?? []).reduce((s, r) => s + r.unpaidDays, 0);
  const shortfall = (rows ?? []).reduce((s, r) => s + r.deductibleShortfallMinutes, 0);
  const daysIn = (r: SheetRow) => r.workingDays + r.holidays;

  const columns: Column<SheetRow>[] = [
    { key: 'name', header: 'Name', cell: (r) => <div><div style={{ fontWeight: 600 }}>{r.name}</div><div className="ceo-cell-sub">{r.staffCode}</div></div>, filter: 'text', filterValue: (r) => `${r.name} ${r.staffCode}`, sortValue: (r) => r.name, csv: (r) => r.name },
    { key: 'code', header: 'Staff code', cell: (r) => r.staffCode, csv: (r) => r.staffCode, hideOnPhone: true },
    { key: 'role', header: 'Role', cell: (r) => roleLabel(r.role), filter: 'select', filterValue: (r) => roleLabel(r.role), csv: (r) => roleLabel(r.role) },
    { key: 'paid', header: 'Paid days', cell: (r) => `${r.paidDays} / ${daysIn(r)}`, sortValue: (r) => r.paidDays, csv: (r) => r.paidDays, align: 'right' },
    { key: 'lop', header: 'Loss of pay', cell: (r) => r.unpaidDays, sortValue: (r) => r.unpaidDays, csv: (r) => r.unpaidDays, align: 'right' },
    { key: 'short', header: 'Shortfall', cell: (r) => (r.deductibleShortfallMinutes ? hm(r.deductibleShortfallMinutes * 60) : '—'), sortValue: (r) => r.deductibleShortfallMinutes, csv: (r) => r.deductibleShortfallMinutes, align: 'right' },
    { key: 'gross', header: 'Gross', cell: () => <span className="ceo-sub">{PENDING}</span>, hideOnPhone: true },
    { key: 'ded', header: 'Deductions', cell: () => <span className="ceo-sub">{PENDING}</span>, hideOnPhone: true },
    { key: 'net', header: 'Net', cell: () => <span className="ceo-sub">{PENDING}</span>, hideOnPhone: true },
    {
      key: 'check',
      header: '',
      cell: (r) => (r.absentDays ? <StatusPill tone="warn">{`Check: ${r.absentDays} absent`}</StatusPill> : <StatusPill tone="good">Ready</StatusPill>),
      filter: 'select',
      filterValue: (r) => (r.absentDays ? 'Check' : 'Ready'),
      csv: (r) => (r.absentDays ? `Check: ${r.absentDays} absent` : 'Ready'),
    },
    { key: 'full', header: 'Full / half / leave / absent', cell: (r) => `${r.fullDays} / ${r.halfDays} / ${r.paidLeaveDays + r.unpaidLeaveDays} / ${r.absentDays}`, csv: (r) => `${r.fullDays}/${r.halfDays}/${r.paidLeaveDays + r.unpaidLeaveDays}/${r.absentDays}`, hideOnPhone: true },
  ];

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Team'), label: 'Team & access' }} title="Salaries" subtitle="The month's payroll, straight from attendance. Only the CEO and Finance see salaries." actions={<MonthPicker value={month} onChange={setMonth} max={istDateKey(now).slice(0, 7)} />} />
      <TeamTabs />
      <StatGrid>
        <StatTile label="Payroll (net)" value={PENDING} tone="navy" detail="Finance's payroll fills the rupees" loading={sheet.isPending} />
        <StatTile label="People" value={rows?.length ?? '—'} tone="royal" loading={sheet.isPending} />
        <StatTile label="Loss of pay + shortfall" value={rows ? `${lop} d · ${hm(shortfall * 60)}` : '—'} tone="orange" loading={sheet.isPending} />
        <StatTile label="Released by Finance" value="—" tone="good" detail="Not released yet" loading={sheet.isPending} />
      </StatGrid>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.staffCode}
          caption={`Salary sheet ${month}`}
          loading={sheet.isPending}
          error={sheet.error}
          onRetry={() => void sheet.refetch()}
          download={`salary-sheet-${month}`}
          emptyTitle="Nobody marked attendance this month."
        />
        <div className="ceo-note">Worked out from attendance and approved leave · Finance checks and releases · each person downloads their own payslip · PF and ESI start after company registration</div>
      </div>
    </div>
  );
}
