import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { Tabs } from '../../../components/Tabs';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { FilterPanel, SearchField, SelectFilter } from '../../ceo/_kit/kit';
import { PayslipCard, type Payslip } from '../../call-agent/CA14g-Payslip/PayslipCard';
import { FormAction, Note } from '../_kit/kit';
import { ServerDownload } from '../_kit/download';
import { MonthlyPay } from '../_kit/MonthlyPay';
import { PAID_FROM } from '../_kit/labels';
import { STAFF_ROLE, addMonths, dayMonth, istMonthKey, monthName, paidDaysText, shortTime, type SalarySheet, type SheetRow } from '../_kit/payroll';
import '../_kit/fin.css';

/**
 * Salaries — design FN-Salaries.dc.html. Each month's pay for every staff
 * member, worked out from attendance (paid days, loss of pay, shortfall not
 * made up; holidays and weekly offs are paid). Finance checks it and sends the
 * total to the CEO, the CEO approves it, and on the 1st Finance pays each
 * person and records the UTR — the payslip then goes to the person by itself.
 */

function tabLabel(month: string, sheet: SalarySheet | undefined, current: boolean): string {
  if (sheet?.status === 'paid' && sheet.run?.paidAt) return `${monthName(month)} · paid ${formatDateIST(sheet.run.paidAt).replace(/ \d{4}$/, '')}`;
  if (sheet?.status === 'approved') return `${monthName(month)} · approved`;
  if (sheet?.status === 'with_ceo') return `${monthName(month)} · with the CEO`;
  return `${monthName(month)} · ${current ? `on ${dayMonth(`${addMonths(month, 1)}-01`)}` : 'to prepare'}`;
}

function StatusBanner({ sheet }: { sheet: SalarySheet }) {
  const net = formatINR(sheet.totals.netPaise);
  if (sheet.closed) return <div className="rule fin-banner">{sheet.label} is closed on the month-end review — its salaries can't be changed.</div>;
  switch (sheet.status) {
    case 'draft':
      return (
        <div className="rule fin-banner" style={{ borderLeftColor: 'var(--royal)' }}>
          {sheet.canPrepare ? (
            <>
              Check the sheet worked out from attendance, then send the total ({net} net for {sheet.totals.people} people) to the CEO.
              {sheet.missingSalary.length > 0 && (
                <span className="fin-crit"> The CEO sets a monthly pay first for {sheet.missingSalary.map((m) => m.name).join(', ')}.</span>
              )}
              {sheet.openDays.length > 0 && (
                <span className="fin-crit"> Days still open (attendance not final): {sheet.openDays.map((o) => `${o.name} ${o.days.join(', ')}`).join('; ')}.</span>
              )}
            </>
          ) : (
            <>This sheet keeps updating with attendance. It can be sent to the CEO from {formatDateIST(`${sheet.prepareFrom}T00:00:00+05:30`)}, once every day of the month is over.</>
          )}
        </div>
      );
    case 'with_ceo':
      return (
        <div className="rule fin-banner" style={{ borderLeftColor: 'var(--gold-raw)' }}>
          Sent to the CEO by {sheet.run?.preparedBy ?? 'Finance'} on {sheet.run ? formatDateIST(sheet.run.preparedAt) : ''} · {net} net for {sheet.totals.people} people · waiting for the CEO to approve.
        </div>
      );
    case 'returned':
      return (
        <div className="rule fin-banner" style={{ borderLeftColor: 'var(--critical)' }}>
          The CEO sent it back{sheet.run?.returnedReason ? `: “${sheet.run.returnedReason}”` : ''}. Check it and send it again.
        </div>
      );
    case 'approved':
      return (
        <div className="rule fin-banner" style={{ borderLeftColor: 'var(--good)' }}>
          {sheet.run?.approvedBy ?? 'The CEO'} approved {net} on {sheet.run?.approvedAt ? formatDateIST(sheet.run.approvedAt) : ''}. Pay each person from the company account on {formatDateIST(`${sheet.payDay}T00:00:00+05:30`)} and record the UTR — {sheet.totals.paidCount} of {sheet.totals.people} paid so far.
        </div>
      );
    default:
      return (
        <div className="rule fin-banner" style={{ borderLeftColor: 'var(--good)' }}>
          Everyone is paid · {formatINR(sheet.totals.paidPaise)} · payslips are in each person's console.
        </div>
      );
  }
}

function PayslipButton({ month, row }: { month: string; row: SheetRow }) {
  const [open, setOpen] = useState(false);
  const slip = useQuery({
    queryKey: ['finance', 'payslip', month, row.staffId],
    queryFn: () => api.get<Payslip>(`/finance/salaries/${month}/payslips/${row.staffId}`),
    enabled: open,
  });
  return (
    <>
      <Button size="compact" onClick={() => setOpen(true)}>
        Payslip
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Payslip · ${row.name}`}
        width={760}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Close</Button>
            <Button variant="primary" onClick={() => window.print()} disabled={!slip.data}>
              Download PDF
            </Button>
          </>
        }
      >
        {slip.isPending && <SkeletonCard height={360} />}
        {slip.error && <ErrorState error={slip.error} onRetry={() => void slip.refetch()} compact />}
        {slip.data && (
          <div className="console">
            <PayslipCard slip={slip.data} />
          </div>
        )}
      </Modal>
    </>
  );
}

function PaidCell({ sheet, r }: { sheet: SalarySheet; r: SheetRow }) {
  const paid = r.line?.status === 'paid';
  return (
    <>
      <span className="fin-strong">{formatINR(r.netPaise)}</span>
      {paid && <span className="fin-sub">Paid {r.line?.paidAt ? formatDateIST(r.line.paidAt) : ''}{r.line?.utrLast4 ? ` · UTR ****${r.line.utrLast4}` : ''}</span>}
      <span className="fin-row-actions">
        {sheet.status === 'approved' && r.line && !paid && !sheet.closed && (
          <FormAction
            label="Pay and record"
            variant="success"
            size="compact"
            title={`Pay ${formatINR(r.netPaise)} to ${r.name}`}
            description={`Send ${r.name}'s ${monthName(sheet.month)} salary from the company account, then record the UTR here. The payslip goes to ${r.name} by itself.`}
            confirmLabel="Record payment"
            fields={[
              { name: 'utr', kind: 'text', label: 'UTR from the bank', required: r.netPaise > 0, placeholder: '12-digit UTR', inputMode: 'numeric' },
              { name: 'paidFrom', kind: 'select', label: 'Paid from', options: ['bank_transfer', 'upi'].map((v) => ({ value: v, label: PAID_FROM[v] })) },
            ]}
            run={(v) => api.post(`/finance/salaries/${sheet.month}/lines/${r.line!.id}/pay`, { utr: v.utr, paidFrom: v.paidFrom })}
            success={`${r.name} paid and recorded`}
          />
        )}
        {r.line && <PayslipButton month={sheet.month} row={r} />}
      </span>
    </>
  );
}

export default function Salaries() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const [params] = useSearchParams();
  const current = istMonthKey(now);
  const previous = addMonths(current, -1);
  const [month, setMonth] = useState<string>(() => (params.get('month') && /^\d{4}-\d{2}$/.test(params.get('month')!) ? params.get('month')! : previous));
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const tabs = useMemo(() => [...new Set([previous, current, month])].sort(), [previous, current, month]);
  const prevSheet = useQuery({ queryKey: ['finance', 'salaries', previous], queryFn: () => api.get<SalarySheet>('/finance/salaries', { query: { month: previous } }) });
  const query = useQuery({ queryKey: ['finance', 'salaries', month], queryFn: () => api.get<SalarySheet>('/finance/salaries', { query: { month } }) });
  const sheet = query.data;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (sheet?.rows ?? []).filter((r) => (!role || r.role === role) && (!q || `${r.name} ${r.staffCode}`.toLowerCase().includes(q)));
  }, [sheet, role, search]);
  const columns = useMemo<Column<SheetRow>[]>(
    () => [
      { key: 'name', header: 'Name', cell: (r) => <><span className="fin-strong">{r.name}</span><span className="fin-sub">{r.staffCode}</span></>, csv: (r) => r.name, sortValue: (r) => r.name },
      { key: 'role', header: 'Role', cell: (r) => STAFF_ROLE[r.role] ?? r.role, csv: (r) => STAFF_ROLE[r.role] ?? r.role, hideOnPhone: true },
      { key: 'paid', header: 'Paid days', cell: paidDaysText, csv: (r) => r.paidDays, sortValue: (r) => r.paidDays },
      { key: 'lop', header: 'Loss of pay days', cell: (r) => r.lossOfPayDays, csv: (r) => r.lossOfPayDays, sortValue: (r) => r.lossOfPayDays, hideOnPhone: true },
      { key: 'short', header: 'Short time not made up', cell: (r) => shortTime(r.shortfallMinutes), csv: (r) => r.shortfallMinutes, sortValue: (r) => r.shortfallMinutes, hideOnPhone: true },
      { key: 'monthly', header: 'Monthly pay', cell: (r) => (r.correctionOnly ? <StatusPill tone="muted">No longer on the staff</StatusPill> : r.monthlyPaise === null ? <StatusPill tone="warn">Not set</StatusPill> : formatINR(r.monthlyPaise)), csv: (r) => (r.monthlyPaise ?? 0) / 100, sortValue: (r) => r.monthlyPaise ?? 0 },
      {
        key: 'ded',
        header: 'Deductions',
        cell: (r) => (
          <>
            {formatINR(r.deductionsPaise)}
            {r.notEmployedDays > 0 && <span className="fin-sub">{r.notEmployedDays} working day{r.notEmployedDays === 1 ? '' : 's'} not on the staff</span>}
            {r.unmarkedDays > 0 && <span className="fin-sub">{r.unmarkedDays} day{r.unmarkedDays === 1 ? '' : 's'} with no attendance</span>}
            {r.correctionPaise !== 0 && <span className="fin-sub" title={r.correctionNote ?? undefined}>Correction {r.correctionPaise > 0 ? '+' : ''}{formatINR(r.correctionPaise)}</span>}
            {(r.carryForwardPaise ?? 0) < 0 && <span className="fin-sub">{formatINR(-(r.carryForwardPaise ?? 0))} more to take back on the next sheet</span>}
          </>
        ),
        csv: (r) => r.deductionsPaise / 100,
        sortValue: (r) => r.deductionsPaise,
      },
      { key: 'net', header: 'Paid', cell: (r) => (sheet ? <PaidCell sheet={sheet} r={r} /> : null), csv: (r) => r.netPaise / 100, sortValue: (r) => r.netPaise },
    ],
    [sheet],
  );
  const loading = query.isPending;
  const t = sheet?.totals;
  const statusTile = (() => {
    if (!sheet) return { value: '—', label: 'Status' };
    if (sheet.status === 'paid') return { value: sheet.run?.paidAt ? dayMonth(sheet.run.paidAt.slice(0, 10)) : 'Paid', label: `Paid · CEO approved ${sheet.run?.approvedAt ? dayMonth(sheet.run.approvedAt.slice(0, 10)) : ''}` };
    if (sheet.status === 'approved') return { value: `${t?.paidCount ?? 0} / ${t?.people ?? 0}`, label: `Paid so far · pay on ${dayMonth(sheet.payDay)}` };
    if (sheet.status === 'with_ceo') return { value: 'With the CEO', label: `Sent ${sheet.run ? dayMonth(sheet.run.preparedAt.slice(0, 10)) : ''}` };
    if (sheet.status === 'returned') return { value: 'Sent back', label: 'Check and send again' };
    return { value: dayMonth(sheet.payDay), label: `Pay day · send to the CEO from ${dayMonth(sheet.prepareFrom)}` };
  })();
  const upcoming = current;
  const prepareLabel = sheet?.status === 'with_ceo' ? 'Work it out again' : sheet?.status === 'returned' ? 'Send it again' : 'Send the total to the CEO';
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('FN-Home'), label: 'Money today' }} title="Salaries" subtitle="Each month's pay for every staff member, worked out from attendance." showSearch={false} />
      <Tabs
        label="Month"
        value={month}
        onChange={setMonth}
        items={tabs.map((m) => ({ key: m, label: tabLabel(m, m === month ? sheet : m === previous ? prevSheet.data : undefined, m === current) }))}
      />
      {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      <StatGrid>
        <StatTile label={`${monthName(month)} pay (net)`} value={t ? formatINR(t.netPaise) : '—'} tone="good" loading={loading} />
        <StatTile label="People" value={t?.people ?? '—'} tone="royal" loading={loading} />
        <StatTile label="Loss of pay + short time" value={t ? formatINR(t.lossOfPayAndShortfallPaise) : '—'} tone="orange" loading={loading} />
        <StatTile label={statusTile.label} value={statusTile.value} tone="cyan" loading={loading} />
      </StatGrid>
      {sheet && <StatusBanner sheet={sheet} />}
      {sheet && !sheet.closed && (sheet.status === 'draft' || sheet.status === 'with_ceo' || sheet.status === 'returned') && sheet.canPrepare && (
        <div className="fin-foot" style={{ justifyContent: 'flex-start' }}>
          <FormAction
            label={prepareLabel}
            variant="primary"
            title={`Send ${sheet.label} pay to the CEO`}
            description={`${formatINR(sheet.totals.netPaise)} net for ${sheet.totals.people} people, worked out from attendance and approved leave. Working days with no attendance are marked absent first; the sheet is then frozen and the CEO approves the total or sends it back.`}
            confirmLabel="Send to the CEO"
            disabled={sheet.missingSalary.length > 0}
            run={() => api.post(`/finance/salaries/${sheet.month}/prepare`)}
            success="Sent to the CEO for approval"
          />
        </div>
      )}
      <FilterPanel>
        <SelectFilter
          label="Role"
          value={role}
          onChange={setRole}
          options={[{ value: '', label: 'All' }, ...['call_agent', 'field_agent', 'team_lead', 'manager', 'finance'].map((r) => ({ value: r, label: STAFF_ROLE[r] }))]}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Name" />
      </FilterPanel>
      <Card flush>
        <DataTable
          columns={columns}
          rows={sheet ? rows : undefined}
          rowKey={(r) => r.staffId}
          caption={`Salary sheet · ${monthName(month, true)}`}
          loading={loading}
          error={query.error}
          onRetry={() => void query.refetch()}
          pageSize={50}
          emptyTitle="No rows match these filters. Change a filter to see more."
        />
        <Note>
          Worked out only from attendance: on the staff all month, the monthly pay (approved leave, weekly offs and holidays are paid) · a day's pay is the monthly pay ÷ {sheet?.salaryDays ?? 26} in every month · joined, left or away part of the month: paid for the days on the staff, monthly pay ÷ {sheet?.salaryDays ?? 26} × working days on the staff, never more than the monthly pay (the leaving day is paid) · absence without leave is loss of pay (half for a half day) · short time not made up by month end is deducted · a change to an approved month comes as a correction on the next sheet · PF, ESI and professional tax: ₹0 — {sheet?.statutory.note.toLowerCase() ?? 'added after company registration'}
        </Note>
      </Card>
      <div className="fin-foot" style={{ justifyContent: 'flex-start' }}>
        <ServerDownload label="Download salary sheet (Excel)" path="/finance/salaries/sheet.csv" query={{ month }} filename={`salary-sheet-${month}.csv`} />
        <FormAction
          label="Send payslips again"
          title="Send payslips again"
          description="Everyone already paid for this month gets a bell that their payslip is ready to open and download."
          disabled={!t || t.paidCount === 0}
          run={() => api.post<{ sent: number }>(`/finance/salaries/${month}/payslips/resend`)}
          success={(r) => `Payslips sent again to ${(r as { sent: number }).sent} people`}
        />
      </div>
      <Card title={`How ${monthName(upcoming)} will be paid`}>
        <div className="fin-tl">
          <div>
            <span className="t">{dayMonth(`${addMonths(upcoming, 1)}-01`)}</span>
            <span className="dot" style={{ background: 'var(--royal)' }} />
            <span>{monthName(upcoming)} is over: the system works out its pay from final attendance and approved leave</span>
            <span />
          </div>
          <div>
            <span className="t">{dayMonth(`${addMonths(upcoming, 1)}-01`)}</span>
            <span className="dot" style={{ background: 'var(--royal)' }} />
            <span>You check it and send the total to the CEO</span>
            <span />
          </div>
          <div>
            <span className="t">{dayMonth(`${addMonths(upcoming, 1)}-01`)}</span>
            <span className="dot" style={{ background: 'var(--gold-raw)' }} />
            <span>The CEO approves the total</span>
            <span />
          </div>
          <div>
            <span className="t">{dayMonth(`${addMonths(upcoming, 1)}-01`)}</span>
            <span className="dot" style={{ background: 'var(--good)' }} />
            <span>You pay everyone and record each UTR · payslips go out by themselves</span>
            <span />
          </div>
        </div>
      </Card>
      <MonthlyPay months={[...new Set([previous, current, addMonths(current, 1)])]} canEdit={false} />
    </div>
  );
}
