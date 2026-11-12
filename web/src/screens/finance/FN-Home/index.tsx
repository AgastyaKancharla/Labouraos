import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { Button, ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { HomeNotifications } from '../../../components/HomeNotifications';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { canExportLists, downloadTextFile, toCsv } from '../../../lib/csv';
import { formatMonthIST, formatTimeIST, istPartOfDay } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { firstName } from '../_kit/labels';
import '../_kit/fin.css';

/**
 * Money today — design FN-Home.dc.html (guide: Finance portal, approval
 * limits). Money in, money out and what needs paying today, all worked out on
 * the server (GET /finance/home).
 */
interface Count {
  count: number;
  paise: number;
}
export interface HomeResponse {
  stats: {
    receivedThisMonthPaise: number;
    paidOutThisMonthPaise: number;
    booksBalancePaise: number;
    refundsToPayPaise: number;
    refundsToPayCount: number;
    gstLastMonthPaise: number;
    gstMonth: string;
    gstDue: { gstr1: string; gstr3b: string };
  };
  todo: {
    refundsWithinLimit: Count;
    refundsWithCeo: Count;
    paymentsToSort: Count;
    payoutsReady: Count;
    payoutsFailed: Count;
    feesOverdue: Count;
    billsToPay: Count;
    tdsWarnings: number;
  };
  today: { id: string; at: string; direction: 'credit' | 'debit'; amountPaise: number; what: string; status: string; reference: string | null; source: string }[];
  limits: { businessRefundLimitPaise: number; expenseLimitPaise: number; referralTdsYearlyLimitPaise: number };
}

const SHORT_DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

interface TodoRow extends Count {
  what: string;
  to: string;
}

const TODO_COLUMNS: Column<TodoRow>[] = [
  { key: 'what', header: 'What' },
  { key: 'count', header: 'How many', cell: (r) => r.count },
  { key: 'paise', header: 'Amount', cell: (r) => formatINR(r.paise) },
  { key: 'open', header: '', align: 'right', cell: (r) => (r.count > 0 ? <ButtonLink to={r.to}>Open</ButtonLink> : null) },
];

const DOT: Record<string, string> = { matched: 'var(--good)', matched_tds: 'var(--gold-raw)', unknown: 'var(--critical)', returned: 'var(--royal)', ignored: 'var(--text-faint)' };

function lineText(l: HomeResponse['today'][number]): string {
  if (l.direction === 'debit') return `${l.what} · ${formatINR(l.amountPaise)}${l.reference ? ` · UTR ${l.reference}` : ''}`;
  if (l.status === 'unknown') return `${formatINR(l.amountPaise)} from ${l.what} · nothing matches`;
  if (l.status === 'matched_tds') return `${formatINR(l.amountPaise)} from ${l.what} · less than the invoice, TDS recorded`;
  return `${formatINR(l.amountPaise)} from ${l.what} · matched`;
}

export default function MoneyToday() {
  const to = useScreenPath();
  const t = useT();
  const now = useNow(60_000);
  const { session } = useAuth();
  const query = useQuery({ queryKey: ['finance', 'home'], queryFn: () => api.get<HomeResponse>('/finance/home'), refetchInterval: 60_000 });
  const d = query.data;
  const loading = query.isPending;
  const name = firstName(session?.staff.name);
  const todo: TodoRow[] = d
    ? [
        { what: 'Refunds within your limit', ...d.todo.refundsWithinLimit, to: to('FN-Payouts') + '?who=refunds' },
        { what: 'Payments to sort out', ...d.todo.paymentsToSort, to: to('FN-MoneyIn') + '?status=needs' },
        { what: 'Payouts to pay today', ...d.todo.payoutsReady, to: to('FN-Payouts') + '?status=ready' },
        { what: 'Payouts that failed at the bank', ...d.todo.payoutsFailed, to: to('FN-Payouts') + '?status=failed' },
        { what: 'Placement fees past their due time', ...d.todo.feesOverdue, to: to('FN-Invoices') + '?status=overdue' },
        { what: 'Bills waiting to be paid', ...d.todo.billsToPay, to: to('FN-Expenses') + '?status=to_pay' },
      ]
    : [];
  const downloadToday = () => {
    if (!d) return;
    downloadTextFile(
      `money-today-${now.toISOString().slice(0, 10)}.csv`,
      toCsv(d.today, [
        { header: 'Time (IST)', value: (l) => formatTimeIST(l.at) },
        { header: 'In / out', value: (l) => (l.direction === 'credit' ? 'In' : 'Out') },
        { header: 'Amount (₹)', value: (l) => l.amountPaise / 100 },
        { header: 'What', value: (l) => l.what },
        { header: 'Status', value: (l) => l.status },
        { header: 'Reference', value: (l) => l.reference },
      ]),
    );
  };
  return (
    <div className="lb-page">
      <TopBar
        eyebrow={`Finance · ${SHORT_DAY.format(now).replace(',', '')}`}
        title={name ? t(`greeting.${istPartOfDay(now)}`, { name }) : 'Money today'}
        subtitle="Money in, money out and what needs paying today."
        showSearch={false}
        actions={
          canExportLists(session?.staff.role) ? (
            <Button onClick={downloadToday} disabled={!d}>
              Download today (Excel)
            </Button>
          ) : null
        }
      />
      <HomeNotifications />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatTile label={`Received in ${formatMonthIST(now).split(' ')[0]}`} value={d ? formatINR(d.stats.receivedThisMonthPaise) : '—'} tone="good" loading={loading} to={to('FN-MoneyIn')} />
            <StatTile label={`Paid out in ${formatMonthIST(now).split(' ')[0]}`} value={d ? formatINR(d.stats.paidOutThisMonthPaise) : '—'} tone="orange" loading={loading} to={to('FN-Payouts')} />
            <StatTile label="In the bank (our books)" value={d ? formatINR(d.stats.booksBalancePaise) : '—'} tone="royal" loading={loading} to={to('FN-Bank')} />
            <StatTile label="Refunds to pay" value={d ? formatINR(d.stats.refundsToPayPaise) : '—'} tone="red" loading={loading} to={to('FN-Payouts') + '?who=refunds'} />
            <StatTile label={d ? `GST to pay for ${formatMonthIST(d.stats.gstMonth).split(' ')[0]}` : 'GST to pay'} value={d ? formatINR(d.stats.gstLastMonthPaise) : '—'} tone="gold" loading={loading} />
          </StatGrid>

          <Card title="To do today" flush>
            <DataTable
              columns={TODO_COLUMNS}
              rows={todo}
              rowKey={(r) => r.what}
              caption="To do today"
              loading={loading}
              pageSize={20}
              emptyTitle="Nothing to do right now."
            />
          </Card>
          {d && d.todo.refundsWithCeo.count > 0 && (
            <div className="rule" style={{ borderLeftColor: 'var(--royal)', fontSize: 12.5 }}>
              {d.todo.refundsWithCeo.count} refund{d.todo.refundsWithCeo.count === 1 ? ' is' : 's are'} with the CEO ({formatINR(d.todo.refundsWithCeo.paise)}) — above your limit, outside the rules, or sent by you.
              {d.todo.tdsWarnings > 0 && ` ${d.todo.tdsWarnings} referral payout${d.todo.tdsWarnings === 1 ? ' crosses' : 's cross'} the TDS limit.`}
            </div>
          )}

          <div className="two-col">
            <Card title="Money moving today" aside={<ButtonLink to={to('FN-Bank')}>Bank</ButtonLink>}>
              {loading ? (
                <SkeletonCard height={160} />
              ) : d && d.today.length ? (
                <div className="fin-tl">
                  {d.today.map((l) => (
                    <div key={l.id}>
                      <span className="t">{formatTimeIST(l.at)}</span>
                      <span className="dot" style={{ background: l.direction === 'debit' ? 'var(--royal)' : (DOT[l.status] ?? 'var(--good)') }} />
                      <span>{lineText(l)}</span>
                      {l.status === 'unknown' ? (
                        <Link to={to('FN-MoneyIn') + '?status=needs'} className="fin-strong">
                          Match
                        </Link>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="fin-sub">No money has moved through the bank today yet.</p>
              )}
            </Card>
            <Card title="Your limits">
              {d ? (
                <>
                  <div className="fin-kv">
                    <span>Job seeker ₹499 refunds</span>
                    <span>You approve and pay</span>
                    <span>Business refunds</span>
                    <span>You approve up to {formatINR(d.limits.businessRefundLimitPaise)} · above goes to the CEO</span>
                    <span>Refunds outside the rules</span>
                    <span>Always the CEO</span>
                    <span>Payouts and joining rewards</span>
                    <span>You pay them every day once due</span>
                    <span>Expenses</span>
                    <span>Up to {formatINR(d.limits.expenseLimitPaise)} with a bill</span>
                  </div>
                  <p className="fin-note">Everything you do is logged · the CEO checks and closes each month</p>
                  <ButtonLink to={to('FN-Limits')}>See all limits</ButtonLink>
                </>
              ) : (
                <SkeletonCard height={160} />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
