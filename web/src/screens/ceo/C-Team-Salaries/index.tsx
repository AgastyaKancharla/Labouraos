import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { DataTable, type Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST, istDateKey } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { FormAction } from '../../finance/_kit/kit';
import { ServerDownload } from '../../finance/_kit/download';
import { MonthlyPay } from '../../finance/_kit/MonthlyPay';
import { paidDaysText, shortTime, type SalarySheet, type SheetRow } from '../../finance/_kit/payroll';
import { roleLabel } from '../_kit/format';
import { TeamTabs } from '../_kit/tabs';
import { MonthPicker, monthName, previousMonthKey, shiftMonth } from '../_kit/month';
import '../../finance/_kit/fin.css';

/**
 * Salaries — design C-Team-Salaries.dc.html. The month's payroll straight
 * from attendance (paid days count weekly offs and holidays; loss of pay and
 * shortfall not made up are deducted), with the rupees from Finance's salary
 * sheet (GET /finance/salaries). Finance sends the total here; the CEO
 * approves it or sends it back, and Finance then pays on the 1st. Only the
 * CEO and Finance see salaries.
 */
function released(sheet: SalarySheet | undefined): { value: string; detail: string } {
  if (!sheet) return { value: '—', detail: '' };
  if (sheet.status === 'paid') return { value: sheet.run?.paidAt ? formatDateIST(sheet.run.paidAt).replace(/ \d{4}$/, '') : 'Paid', detail: 'All paid' };
  if (sheet.status === 'approved') return { value: `${sheet.totals.paidCount} / ${sheet.totals.people}`, detail: `Paid so far · pay day ${formatDateIST(`${sheet.payDay}T00:00:00+05:30`)}` };
  if (sheet.status === 'with_ceo') return { value: 'Waiting for you', detail: 'Approve the total below' };
  if (sheet.status === 'returned') return { value: 'Sent back', detail: 'Finance is checking it' };
  return { value: '—', detail: 'Not released yet' };
}

function Approval({ sheet }: { sheet: SalarySheet }) {
  const net = formatINR(sheet.totals.netPaise);
  if (sheet.status === 'with_ceo') {
    return (
      <div className="rule fin-banner" style={{ borderLeftColor: 'var(--gold-raw)' }}>
        <p style={{ margin: '0 0 8px' }}>
          {sheet.run?.preparedBy ?? 'Finance'} sent {sheet.label} pay on {sheet.run ? formatDateIST(sheet.run.preparedAt) : ''}: <strong>{net} net for {sheet.totals.people} people</strong>, worked out from attendance and approved leave.
        </p>
        <span className="fin-row-actions">
          <FormAction
            label="Approve the total"
            variant="success"
            title={`Approve ${sheet.label} pay`}
            description={`${net} net for ${sheet.totals.people} people. Finance then pays each person on ${formatDateIST(`${sheet.payDay}T00:00:00+05:30`)} and records the UTR; payslips go out by themselves.`}
            confirmLabel="Approve"
            run={() => api.post(`/finance/salaries/${sheet.month}/approve`, { netPaise: sheet.totals.netPaise, preparedAt: sheet.run?.preparedAt })}
            success={`${sheet.label} pay approved`}
          />
          <FormAction
            label="Send back"
            variant="danger"
            title="Send the salary sheet back to Finance"
            fields={[{ name: 'reason', kind: 'text', label: 'What should Finance check', required: true }]}
            run={(v) => api.post(`/finance/salaries/${sheet.month}/send-back`, { reason: v.reason })}
            success="Sent back to Finance"
          />
        </span>
      </div>
    );
  }
  if (sheet.status === 'approved') return <div className="rule fin-banner" style={{ borderLeftColor: 'var(--good)' }}>You approved {net} on {sheet.run?.approvedAt ? formatDateIST(sheet.run.approvedAt) : ''} · Finance pays each person and records the UTR.</div>;
  if (sheet.status === 'returned') return <div className="rule fin-banner" style={{ borderLeftColor: 'var(--critical)' }}>Sent back to Finance{sheet.run?.returnedReason ? `: “${sheet.run.returnedReason}”` : ''}.</div>;
  if (sheet.status === 'draft') return <div className="rule fin-banner">Finance sends this month's total to you from {formatDateIST(`${sheet.prepareFrom}T00:00:00+05:30`)}. Until then these figures update with attendance.</div>;
  return null;
}

export default function Salaries() {
  const to = useScreenPath();
  const now = useNow();
  const [params] = useSearchParams();
  const asked = params.get('month');
  const [month, setMonth] = useState(() => (asked && /^\d{4}-\d{2}$/.test(asked) ? asked : previousMonthKey(istDateKey(now))));
  const sheet = useQuery({
    queryKey: ['finance', 'salaries', month],
    queryFn: () => api.get<SalarySheet>('/finance/salaries', { query: { month } }),
  });
  const data = sheet.data;
  const rows = data?.rows;
  const rel = released(data);

  const columns: Column<SheetRow>[] = [
    { key: 'name', header: 'Name', cell: (r) => <div><div style={{ fontWeight: 600 }}>{r.name}</div><div className="ceo-cell-sub">{r.staffCode}</div></div>, filter: 'text', filterValue: (r) => `${r.name} ${r.staffCode}`, sortValue: (r) => r.name, csv: (r) => r.name },
    { key: 'role', header: 'Role', cell: (r) => roleLabel(r.role), filter: 'select', filterValue: (r) => roleLabel(r.role), csv: (r) => roleLabel(r.role) },
    { key: 'paid', header: 'Paid days', cell: paidDaysText, sortValue: (r) => r.paidDays, csv: (r) => r.paidDays, align: 'right' },
    { key: 'lop', header: 'Loss of pay', cell: (r) => r.lossOfPayDays, sortValue: (r) => r.lossOfPayDays, csv: (r) => r.lossOfPayDays, align: 'right' },
    { key: 'short', header: 'Shortfall', cell: (r) => shortTime(r.shortfallMinutes), sortValue: (r) => r.shortfallMinutes, csv: (r) => r.shortfallMinutes, align: 'right' },
    { key: 'gross', header: 'Gross', cell: (r) => (r.correctionOnly ? <StatusPill tone="muted">No longer on the staff</StatusPill> : r.monthlyPaise === null ? <StatusPill tone="warn">Not set</StatusPill> : formatINR(r.grossPaise)), sortValue: (r) => r.grossPaise, csv: (r) => r.grossPaise / 100, align: 'right' },
    { key: 'ded', header: 'Deductions', cell: (r) => <>{formatINR(r.deductionsPaise)}{r.correctionPaise !== 0 && <div className="ceo-cell-sub" title={r.correctionNote ?? undefined}>Correction {r.correctionPaise > 0 ? '+' : ''}{formatINR(r.correctionPaise)}</div>}{(r.carryForwardPaise ?? 0) < 0 && <div className="ceo-cell-sub">{formatINR(-(r.carryForwardPaise ?? 0))} more to take back next sheet</div>}</>, sortValue: (r) => r.deductionsPaise, csv: (r) => r.deductionsPaise / 100, align: 'right' },
    { key: 'net', header: 'Net', cell: (r) => <strong>{formatINR(r.netPaise)}</strong>, sortValue: (r) => r.netPaise, csv: (r) => r.netPaise / 100, align: 'right' },
    {
      key: 'check',
      header: '',
      cell: (r) =>
        r.line?.status === 'paid' ? (
          <StatusPill tone="good">Paid</StatusPill>
        ) : r.monthlyPaise === null ? (
          <StatusPill tone="warn">No pay set</StatusPill>
        ) : r.absentDays ? (
          <StatusPill tone="warn">{`Check: ${r.absentDays} absent`}</StatusPill>
        ) : (
          <StatusPill tone="good">Ready</StatusPill>
        ),
      filter: 'select',
      filterValue: (r) => (r.line?.status === 'paid' ? 'Paid' : r.absentDays ? 'Check' : 'Ready'),
      csv: (r) => (r.line?.status === 'paid' ? 'Paid' : r.absentDays ? `Check: ${r.absentDays} absent` : 'Ready'),
    },
    { key: 'full', header: 'Full / half / leave / absent', cell: (r) => `${r.fullDays} / ${r.halfDays} / ${r.paidLeaveDays + r.unpaidLeaveDays} / ${r.absentDays}`, csv: (r) => `${r.fullDays}/${r.halfDays}/${r.paidLeaveDays + r.unpaidLeaveDays}/${r.absentDays}`, hideOnPhone: true },
  ];

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('C-Team'), label: 'Team & access' }}
        title="Salaries"
        subtitle="The month's payroll, straight from attendance. Only the CEO and Finance see salaries."
        actions={
          <span style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <MonthPicker value={month} onChange={setMonth} max={istDateKey(now).slice(0, 7)} />
            <ServerDownload label="Download (Excel)" path="/finance/salaries/sheet.csv" query={{ month }} filename={`salary-sheet-${month}.csv`} />
          </span>
        }
      />
      <TeamTabs />
      {sheet.error && <ErrorState error={sheet.error} onRetry={() => void sheet.refetch()} />}
      <StatGrid>
        <StatTile label={`${monthName(month, false)} payroll (net)`} value={data ? formatINR(data.totals.netPaise) : '—'} tone="navy" loading={sheet.isPending} />
        <StatTile label="People" value={rows?.length ?? '—'} tone="royal" loading={sheet.isPending} />
        <StatTile label="Loss of pay + shortfall" value={data ? formatINR(data.totals.lossOfPayAndShortfallPaise) : '—'} tone="orange" loading={sheet.isPending} />
        <StatTile label="Released by Finance" value={rel.value} tone="good" detail={rel.detail} loading={sheet.isPending} />
      </StatGrid>
      {data && <Approval sheet={data} />}
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.staffCode}
          caption={`Salary sheet ${month}`}
          loading={sheet.isPending}
          error={sheet.error}
          onRetry={() => void sheet.refetch()}
          emptyTitle="Nobody was on the staff this month."
        />
        <div className="ceo-note">Worked out from attendance and approved leave (weekly offs and holidays are paid) · a day's pay is the monthly pay ÷ 26 · working days before joining, away or after leaving are not paid · Finance checks and releases · each person downloads their own payslip · PF, ESI and professional tax start after company registration</div>
      </div>
      <MonthlyPay months={[...new Set([month, istDateKey(now).slice(0, 7), shiftMonth(istDateKey(now).slice(0, 7), 1)])].sort()} canEdit />
    </div>
  );
}
