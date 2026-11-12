import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatINR } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { Note } from '../_kit/kit';
import { ServerDownload } from '../_kit/download';
import { istMonthKey, monthName } from '../_kit/payroll';
import '../_kit/fin.css';

/**
 * Reports — design FN-Reports.dc.html. Profit and loss and cash flow for the
 * period picked (the same figures as the CEO's Expenses page, salaries from
 * payroll), and ready-made files for the CA: the books, GST data in the
 * GSTR-1 layout, the TDS registers and the salary sheet.
 */
interface Summary {
  period: { from: string; to: string; month: string };
  profit: {
    revenue: { activationPaise: number; activationCount: number; placementFeePaise: number; placementCount: number; refundsPaise: number; refundsCount: number; netRevenuePaise: number; gstCollectedPaise: number };
    expenses: { billsPaise: number; payoutsPaise: number; salariesPaise: number; salaryMonthsPending?: string[]; totalPaise: number };
    profitPaise: number;
  };
  cashFlow: {
    startPaise: number;
    moneyInPaise: number;
    moneyOutPaise: number;
    out: { refundsAndPayoutsPaise: number; expensesPaise: number; salariesPaise: number; returnedPaise: number };
    endPaise: number;
    daysClosed: number;
    days: number;
    note: string;
  };
}

function Line({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return (
    <div style={{ display: 'contents' }}>
      <span>{label}</span>
      <span className={strong ? 'fin-strong' : undefined} style={{ textAlign: 'right' }}>
        {minus && value > 0 ? formatINR(-value) : formatINR(value)}
      </span>
    </div>
  );
}

export default function Reports() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const query = useQuery({
    queryKey: ['finance', 'reports', period],
    queryFn: () => api.get<Summary>('/finance/reports', { query: periodToUtcRange(period) }),
    placeholderData: keepPreviousData,
  });
  const s = query.data;
  const month = s?.period.month ?? istMonthKey(now);
  const loss = s ? s.profit.profitPaise < 0 : false;
  const files = [
    { key: 'books', title: `Books · ${monthName(month)}`, what: 'Every rupee in and out, with invoice, receipt and UTR', path: '/finance/reports/books.csv', file: `books-${month}.csv` },
    { key: 'gst', title: `GST data · ${monthName(month)}`, what: 'Invoices and credit notes in the GSTR-1 layout', path: '/finance/reports/gstr1.csv', file: `gstr1-data-${month}.csv` },
    { key: 'tds', title: 'TDS registers', what: 'TDS taken by businesses and referral commission against the limit', path: '/finance/reports/tds.csv', file: `tds-registers-${month}.csv` },
    { key: 'salary', title: `Salary sheet · ${monthName(month)}`, what: 'Pay, deductions and payments', path: '/finance/reports/salary-sheet.csv', file: `salary-sheet-${month}.csv` },
  ];
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('FN-Home'), label: 'Money today' }}
        title="Reports"
        subtitle={`Profit and loss, cash flow, and ready-made files for the CA. Showing ${periodRangeLabel(period)}.`}
        period={period}
        onPeriodChange={setPeriod}
        showSearch={false}
      />
      {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      <StatGrid>
        <StatTile label="Net revenue (ex-GST)" value={s ? formatINR(s.profit.revenue.netRevenuePaise) : '—'} tone="good" loading={query.isPending} />
        <StatTile label="Expenses" value={s ? formatINR(s.profit.expenses.totalPaise) : '—'} tone="orange" loading={query.isPending} />
        <StatTile label={loss ? 'Loss' : 'Profit'} value={s ? formatINR(s.profit.profitPaise) : '—'} tone={loss ? 'red' : 'good'} loading={query.isPending} />
        <StatTile label="Cash at the end" value={s ? formatINR(s.cashFlow.endPaise) : '—'} tone="royal" loading={query.isPending} />
      </StatGrid>
      {query.isPending && <SkeletonCard height={260} />}
      {s && (
        <div className="two-col fin-two">
          <Card title={`Profit and loss · ${periodRangeLabel(period)}`}>
            <div className="fin-kv">
              <Line label={`Registration fees (${s.profit.revenue.activationCount})`} value={s.profit.revenue.activationPaise} />
              <Line label={`Placement fees (${s.profit.revenue.placementCount})`} value={s.profit.revenue.placementFeePaise} />
              <Line label={`Refunds (${s.profit.revenue.refundsCount})`} value={s.profit.revenue.refundsPaise} minus />
              <Line label="Net revenue" value={s.profit.revenue.netRevenuePaise} strong />
              <Line label="Salaries (from payroll)" value={s.profit.expenses.salariesPaise} minus />
              <Line label="Bills" value={s.profit.expenses.billsPaise} minus />
              <Line label="Referral payouts & joining rewards" value={s.profit.expenses.payoutsPaise} minus />
              <Line label={loss ? 'Loss' : 'Profit'} value={s.profit.profitPaise} strong />
            </div>
            <Note>
              GST collected ({formatINR(s.profit.revenue.gstCollectedPaise)}) is owed to the government, never income · salaries count once the CEO approves the month
              {s.profit.expenses.salaryMonthsPending && s.profit.expenses.salaryMonthsPending.length > 0 ? ` · not approved yet: ${s.profit.expenses.salaryMonthsPending.map((m) => monthName(m)).join(', ')}` : ''}
            </Note>
          </Card>
          <Card title={`Cash flow · ${periodRangeLabel(period)}`}>
            <div className="fin-kv">
              <Line label="Start" value={s.cashFlow.startPaise} />
              <Line label="Money in" value={s.cashFlow.moneyInPaise} />
              <Line label="Refunds and payouts" value={s.cashFlow.out.refundsAndPayoutsPaise} minus />
              <Line label="Bills paid" value={s.cashFlow.out.expensesPaise} minus />
              <Line label="Salaries paid" value={s.cashFlow.out.salariesPaise} minus />
              <Line label="Money returned" value={s.cashFlow.out.returnedPaise} minus />
              <Line label="End" value={s.cashFlow.endPaise} strong />
            </div>
            <Note>
              {s.cashFlow.note} · {s.cashFlow.daysClosed} of {s.cashFlow.days} bank days closed
            </Note>
          </Card>
        </div>
      )}
      <Card title="Downloads for the CA" flush>
        <div className="scrollx">
          <table>
            <caption className="sr-only">Downloads for the CA</caption>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">What's in it</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.key}>
                  <td className="fin-strong">{f.title}</td>
                  <td>{f.what}</td>
                  <td style={{ textAlign: 'right' }}>
                    <ServerDownload label="Download (Excel)" size="compact" path={f.path} query={{ month }} filename={f.file} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Note>Laboura keeps its own books · the CA uses these to file returns and prepare the company's yearly accounts · files are for the month the period ends in ({monthName(month, true)})</Note>
    </div>
  );
}
