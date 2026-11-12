import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatusPill } from '../../../components/Badge';
import { Tabs } from '../../../components/Tabs';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { FormAction, Note } from '../_kit/kit';
import { ServerDownload } from '../_kit/download';
import { addMonths, dayMonth, istMonthKey, monthName } from '../_kit/payroll';
import '../_kit/fin.css';

/**
 * Tax — design FN-Tax.dc.html. GST and TDS for each month, ready for the CA:
 * GST on placement invoices less refunds of those invoices (credit notes — the
 * CA confirms), TDS businesses took from our fees (certificates to collect),
 * referral commission per partner this year against the TDS limit (a warning
 * only until the CA confirms the rule), and the filing dates as reminders.
 */
interface Tax {
  month: string;
  label: string;
  gst: { invoices: { count: number; feePaise: number; gstPaise: number }; placementFees?: { count: number; feePaise: number; gstPaise: number }; bypassCharges?: { count: number; feePaise: number; gstPaise: number }; creditNotes: { count: number; feePaise: number; gstPaise: number }; receipts: { count: number }; payablePaise: number; ratePercent: number; companyGstin: string | null };
  dates: { key: string; label: string; due: string; what: string; daysLeft: number }[];
  tdsReceivable: { id: string; business: string | null; placementCode: string | null; invoiceCode: string | null; amountPaise: number; note: string; status: string; recordedAt: string }[];
  tdsReceivableTotalPaise: number;
  referralTds: { financialYear: string; limitPaise: number; nextPayoutPaise: number; rows: { referralId: string; code: string | null; name: string | null; paidThisYearPaise: number; pendingPaise: number; payouts: number; status: 'over' | 'crosses_next' | 'below' }[] };
  notes: { gst: string; referral: string };
}
type TdsRow = Tax['tdsReceivable'][number];
type ReferralRow = Tax['referralTds']['rows'][number];

function dueText(d: Tax['dates'][number]): string {
  if (d.daysLeft < 0) return `${dayMonth(d.due)} · passed`;
  if (d.daysLeft === 0) return `${dayMonth(d.due)} · today`;
  return `${dayMonth(d.due)} · in ${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'}`;
}

export default function TaxPage() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const last = addMonths(istMonthKey(now), -1);
  const [month, setMonth] = useState(last);
  const query = useQuery({ queryKey: ['finance', 'tax', month], queryFn: () => api.get<Tax>('/finance/tax', { query: { month } }) });
  const t = query.data;
  const tdsColumns: Column<TdsRow>[] = [
    { key: 'biz', header: 'Business', cell: (r) => r.business ?? '—', csv: (r) => r.business },
    { key: 'inv', header: 'Invoice', cell: (r) => r.invoiceCode ?? r.placementCode ?? '—', csv: (r) => r.invoiceCode },
    { key: 'tds', header: 'TDS', cell: (r) => formatINR(r.amountPaise), csv: (r) => r.amountPaise / 100, sortValue: (r) => r.amountPaise },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <>
          <StatusPill tone={r.status === 'certificate_received' ? 'good' : 'warn'}>{r.status === 'certificate_received' ? 'Certificate received' : 'Certificate due'}</StatusPill>
          {r.status !== 'certificate_received' && (
            <span className="fin-row-actions">
              <FormAction
                label="Mark certificate received"
                size="compact"
                title="TDS certificate received"
                description={`The business has sent the TDS certificate for ${formatINR(r.amountPaise)} (${r.note}).`}
                run={() => api.post(`/finance/tds-receivables/${r.id}/certificate-received`)}
                success="Certificate marked received"
              />
            </span>
          )}
        </>
      ),
      csv: (r) => r.status,
    },
  ];
  const refColumns: Column<ReferralRow>[] = [
    { key: 'partner', header: 'Partner', cell: (r) => <><span className="fin-strong">{r.name ?? '—'}</span><span className="fin-sub">{r.code}</span></>, csv: (r) => `${r.code ?? ''} ${r.name ?? ''}` },
    { key: 'for', header: 'For', cell: () => 'Referral commission', hideOnPhone: true },
    { key: 'year', header: 'This year', cell: (r) => <>{formatINR(r.paidThisYearPaise)}{r.pendingPaise > 0 && <span className="fin-sub">+ {formatINR(r.pendingPaise)} waiting</span>}</>, csv: (r) => r.paidThisYearPaise / 100, sortValue: (r) => r.paidThisYearPaise },
    {
      key: 'status',
      header: '',
      cell: (r) =>
        r.status === 'over' ? (
          <StatusPill tone="crit">Over {formatINR(t?.referralTds.limitPaise ?? 0)} · ask the CA</StatusPill>
        ) : r.status === 'crosses_next' ? (
          <StatusPill tone="warn">Crosses {formatINR(t?.referralTds.limitPaise ?? 0)} with the next payout</StatusPill>
        ) : (
          <StatusPill tone="good">Below {formatINR(t?.referralTds.limitPaise ?? 0)}</StatusPill>
        ),
      csv: (r) => r.status,
    },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('FN-Home'), label: 'Money today' }} title="Tax" subtitle="GST and TDS for each month, ready for the CA." showSearch={false} actions={<ServerDownload label="Download for the CA (Excel)" path="/finance/reports/tax.csv" query={{ month }} filename={`tax-${month}.csv`} />} />
      <Tabs label="Month" value={month} onChange={setMonth} items={[last, addMonths(last, -1)].map((m) => ({ key: m, label: monthName(m) }))} />
      {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.isPending && <SkeletonCard height={300} />}
      {t && (
        <div className="two-col fin-two">
          <Card title={`GST · ${monthName(month)}`} aside={<ServerDownload label="Download GSTR-1 data" size="compact" path="/finance/reports/gstr1.csv" query={{ month }} filename={`gstr1-data-${month}.csv`} />} flush>
            <div className="scrollx">
            <table>
              <caption className="sr-only">GST for {t.label}</caption>
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col">Count</th>
                  <th scope="col">Value</th>
                  <th scope="col">GST</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Placement invoices</td>
                  <td>{(t.gst.placementFees ?? t.gst.invoices).count}</td>
                  <td>{formatINR((t.gst.placementFees ?? t.gst.invoices).feePaise)}</td>
                  <td>{formatINR((t.gst.placementFees ?? t.gst.invoices).gstPaise)}</td>
                </tr>
                {t.gst.bypassCharges && t.gst.bypassCharges.count > 0 && (
                  <tr>
                    <td>
                      No-bypass charges
                      <span className="fin-sub">Fee + penalty, same invoice series</span>
                    </td>
                    <td>{t.gst.bypassCharges.count}</td>
                    <td>{formatINR(t.gst.bypassCharges.feePaise)}</td>
                    <td>{formatINR(t.gst.bypassCharges.gstPaise)}</td>
                  </tr>
                )}
                <tr>
                  <td>
                    Business refunds (fee only)
                    <span className="fin-sub">No credit note yet — the CA decides</span>
                  </td>
                  <td>{t.gst.creditNotes.count}</td>
                  <td>{t.gst.creditNotes.feePaise ? formatINR(-t.gst.creditNotes.feePaise) : formatINR(0)}</td>
                  <td>
                    <span className="fin-sub">GST stays owed</span>
                  </td>
                </tr>
                <tr>
                  <td className="fin-strong">GST to pay</td>
                  <td />
                  <td />
                  <td className="fin-strong">{formatINR(t.gst.payablePaise)}</td>
                </tr>
              </tbody>
            </table>
            </div>
            <div style={{ padding: '0 16px 12px' }}>
              <Note>
                ₹499 registration fees carry no GST ({t.gst.receipts.count} receipts) · monthly filing assumed — the CA may choose quarterly · a business refund returns the fee only: its GST stays owed until the CA answers{t.gst.companyGstin ? ` · GSTIN ${t.gst.companyGstin}` : ' · GSTIN: entered in Settings after registration'}
              </Note>
            </div>
          </Card>
          <Card title="Dates">
            <div className="fin-kv">
              {t.dates.map((d) => (
                <div key={d.key} style={{ display: 'contents' }}>
                  <span>{d.label}</span>
                  <span>
                    {dueText(d)}
                    <span className="fin-sub" style={{ fontWeight: 400 }}>{d.what}</span>
                  </span>
                </div>
              ))}
            </div>
            <Note>Reminders only — there is no CA yet; the CA confirms each date and files the returns.</Note>
          </Card>
        </div>
      )}
      {t && (
        <Card title="TDS businesses took from our fees" aside={<span className="fin-sub">{formatINR(t.tdsReceivableTotalPaise)}</span>} flush>
          <DataTable columns={tdsColumns} rows={t.tdsReceivable} rowKey={(r) => r.id} caption="TDS businesses took from our fees" pageSize={25} emptyTitle="No business deducted TDS this month." download={`tds-taken-${month}`} />
          <div style={{ padding: '0 16px 12px' }}>
            <Note>Check these against the tax department's statement every quarter · they reduce Laboura's income tax</Note>
          </div>
        </Card>
      )}
      {t && (
        <Card title="TDS we take from referral payouts" aside={<span className="fin-sub">Financial year {t.referralTds.financialYear}</span>} flush>
          <DataTable columns={refColumns} rows={t.referralTds.rows} rowKey={(r) => r.referralId} caption="Referral commission this year" pageSize={25} emptyTitle="No referral payouts this year yet." download={`referral-commission-${month}`} />
          <div style={{ padding: '0 16px 12px' }}>
            <Note>2% once a partner's commission crosses {formatINR(t.referralTds.limitPaise)} in a year · nothing is deducted yet — the CA confirms the exact rule · Finance is warned on Payouts before paying</Note>
          </div>
        </Card>
      )}
    </div>
  );
}
