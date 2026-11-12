import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { KeptReportsBar, TeamWeeks, WeekTable, useKeptReport, type WeeklyResponse } from '../../manager/_kit/weekly';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { downloadTextFile, toCsv } from '../../../lib/csv';
import { formatMonthIST, istStartOfDay } from '../../../lib/format/date';
import { formatINR, formatINRCompact } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { Bars, Kv, htmlTable, humanize, printDocument } from '../_kit/kit';

/**
 * Reports — design C-Reports.dc.html. Every number comes from real records.
 * With ?week= it shows the company report kept that Monday (the bell's link).
 */
interface Reports {
  kpis: { netPaise: number; changePercent: number | null; averageFeePaise: number | null; revenuePerAgentPaise: number | null; fillRatePercent: number; averageDaysToFill: number | null; refundsPercentOfRevenue: number };
  totals: { grossPaise: number; refundsPaidPaise: number; placementCount: number };
  monthly: { month: string; netPaise: number }[];
  funnel: { registered: number; paid: number; offered: number; accepted: number; joined: number; paidPercent: number; offeredPercent: number; acceptedPercent: number; joinedPercent: number; stillWorkingDay60Percent: number };
  sources: { source: string; registered: number; paid: number; placed: number; revenuePaise: number }[];
  bestAreas: { area: string; revenuePaise: number; placements: number }[];
  tradesToRecruit: { trade: string; open: number; pool: number }[];
  cohort: { month: string; size: number; placedWithinGuaranteePercent: number; refundedPercent: number; deactivatedPercent: number; stillLookingPercent: number };
}
interface Guarantee {
  range: { total: { couldGoBackPaise: number; safelyEarnedPaise: number; receivedPaise: number } } | null;
}
/** The company report kept each Monday (GET /weekly-reports/:week for the CEO). */
type KeptCompany = WeeklyResponse & { reports: Reports; guarantee: Guarantee | null };

const monthName = (key: string) => formatMonthIST(istStartOfDay(`${key}-01`)).split(' ')[0];

export default function ReportsScreen() {
  const to = useScreenPath();
  const now = useNow(60_000);
  const toast = useToast();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  // ?week=yyyy-mm-dd (the Monday bell's link): the company report kept that Monday, as it was sent.
  const [params, setParams] = useSearchParams();
  const week = params.get('week');
  const openWeek = (w: string | null) => setParams(w ? { week: w } : {});
  const kept = useKeptReport<KeptCompany>(week);
  const liveQuery = useQuery({ queryKey: ['ceo', 'reports', period.from, period.to], queryFn: () => api.get<Reports>('/ceo/reports', { query: periodToUtcRange(period) }), enabled: !week });
  const liveGuarantee = useQuery({ queryKey: ['payments', 'money-under-guarantee', period.from, period.to], queryFn: () => api.get<Guarantee>('/growth/money-under-guarantee', { query: { from: period.from, to: period.to } }), enabled: !week });
  // Profit / loss and cost per placement come from Finance's own figures (GET /finance/reports, CEO and Finance).
  const pnl = useQuery({
    queryKey: ['finance', 'reports', period.from, period.to],
    queryFn: () => api.get<{ profit: { profitPaise: number; costPerPlacementPaise: number | null } }>('/finance/reports', { query: periodToUtcRange(period) }),
    enabled: !week,
  });
  const query = week ? kept : liveQuery;
  const d: Reports | undefined = week ? kept.data?.content.reports : liveQuery.data;
  const guarantee = { data: week ? (kept.data?.content.guarantee ?? undefined) : liveGuarantee.data, isPending: week ? kept.isPending : liveGuarantee.isPending };
  const loading = query.isPending;
  const label = week && kept.data ? `the week of ${kept.data.label}` : periodRangeLabel(period);

  const funnelRows: [string, string][] = d
    ? [
        ['Registered → paid ₹499', `${d.funnel.paidPercent}%`],
        ['Paid → offered a job', `${d.funnel.offeredPercent}%`],
        ['Offered → accepted', `${d.funnel.acceptedPercent}%`],
        ['Accepted → joined', `${d.funnel.joinedPercent}%`],
        ['Joined → still working at day 60', `${d.funnel.stillWorkingDay60Percent}%`],
      ]
    : [];

  const downloadExcel = () => {
    if (!d) return;
    const kpis = [
      ['Net revenue', d.kpis.netPaise / 100],
      ['Average fee per placement', (d.kpis.averageFeePaise ?? 0) / 100],
      ['Revenue per agent', (d.kpis.revenuePerAgentPaise ?? 0) / 100],
      ['Fill rate %', d.kpis.fillRatePercent],
      ['Time to fill (days)', d.kpis.averageDaysToFill ?? ''],
      ['Refunds as % of revenue', d.kpis.refundsPercentOfRevenue],
    ];
    const csv = [
      `Laboura report,${label}`,
      toCsv(kpis, [
        { header: 'Number', value: (r) => r[0] },
        { header: 'Value', value: (r) => r[1] },
      ]),
      toCsv(d.sources, [
        { header: 'Where people came from', value: (r) => humanize(r.source) },
        { header: 'Registered', value: (r) => r.registered },
        { header: 'Paid ₹499', value: (r) => r.paid },
        { header: 'Placed', value: (r) => r.placed },
        { header: 'Revenue (₹)', value: (r) => r.revenuePaise / 100 },
      ]),
    ].join('\r\n');
    downloadTextFile(`laboura-report-${period.from}-to-${period.to}.csv`, csv);
    toast.success('Report downloaded');
  };

  const downloadPdf = () => {
    if (!d) return;
    const ok = printDocument(
      `Laboura report ${label}`,
      `<h1>Laboura report · ${label}</h1>` +
        htmlTable(['Number', 'Value'], [
          ['Net revenue', formatINR(d.kpis.netPaise)],
          ['Average fee per placement', d.kpis.averageFeePaise !== null ? formatINR(d.kpis.averageFeePaise) : '—'],
          ['Revenue per agent', d.kpis.revenuePerAgentPaise !== null ? formatINR(d.kpis.revenuePerAgentPaise) : '—'],
          ['Fill rate', `${d.kpis.fillRatePercent}%`],
          ['Time to fill', d.kpis.averageDaysToFill !== null ? `${d.kpis.averageDaysToFill} days` : '—'],
          ['Refunds as % of revenue', `${d.kpis.refundsPercentOfRevenue}%`],
        ]) +
        htmlTable(['Funnel', ''], funnelRows) +
        htmlTable(['Where people came from', 'Registered', 'Paid ₹499', 'Placed', 'Revenue'], d.sources.map((s) => [humanize(s.source), s.registered, s.paid, s.placed, formatINR(s.revenuePaise)])),
    );
    if (ok) toast.success('Report ready — choose "Save as PDF"');
    else toast.error('Allow pop-ups for this site to save the PDF.');
  };

  const governmentExport = async () => {
    try {
      const rows = await api.get<Record<string, unknown>[]>('/placements/export', { query: periodToUtcRange(period) });
      const list = Array.isArray(rows) ? rows : [];
      const keys = list.length ? Object.keys(list[0]) : ['code'];
      downloadTextFile(`placements-export-${period.from}-to-${period.to}.csv`, toCsv(list, keys.map((k) => ({ header: k, value: (r: Record<string, unknown>) => (r[k] === null || r[k] === undefined ? '' : typeof r[k] === 'object' ? JSON.stringify(r[k]) : String(r[k])) }))));
      toast.success(`Placement export downloaded · ${list.length} rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const k = d?.kpis;
  const gt = guarantee.data?.range?.total;
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Reports"
        subtitle={`How the business is growing and where to put effort next. Every number comes from real records. Showing ${label}.`}
        period={period}
        onPeriodChange={(p) => {
          setPeriod(p);
          if (week) openWeek(null);
        }}
        actions={
          <div className="ceo-actions">
            <Button onClick={downloadPdf} disabled={!d}>
              Download PDF
            </Button>
            <Button onClick={downloadExcel} disabled={!d}>
              Download Excel
            </Button>
            <Button onClick={() => void governmentExport()}>Government placement export</Button>
          </div>
        }
      />
      <KeptReportsBar week={week} onWeek={openWeek} sentAt={kept.data?.sentAt} />
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {week && kept.data && (
            <>
              <WeekTable rows={kept.data.content.rows} note="The whole company that week · sent to you every Monday at 9 AM · weekly target = a week's share of the month's placement plan" />
              <TeamWeeks teams={kept.data.content.teams} when={kept.data.label} />
            </>
          )}
          <StatGrid>
            <StatTile label={`Net revenue${k?.changePercent !== null && k?.changePercent !== undefined ? ` · ${k.changePercent >= 0 ? '↑' : '↓'}${Math.abs(k.changePercent)}%` : ''}`} value={k ? formatINRCompact(k.netPaise) : '—'} tone="good" loading={loading} to={to('C-Payments')} />
            <StatTile label="Could still go back (under guarantee)" value={gt ? formatINR(gt.couldGoBackPaise) : '—'} tone="gold" loading={guarantee.isPending} />
            <StatTile label="Safely earned" value={gt ? formatINR(gt.safelyEarnedPaise) : '—'} tone="cyan" loading={guarantee.isPending} />
            <StatTile label="Average fee per placement" value={k?.averageFeePaise !== null && k?.averageFeePaise !== undefined ? formatINR(k.averageFeePaise) : '—'} tone="royal" loading={loading} />
            <StatTile label="Revenue per agent" value={k?.revenuePerAgentPaise !== null && k?.revenuePerAgentPaise !== undefined ? formatINR(k.revenuePerAgentPaise) : '—'} tone="navy" loading={loading} />
            <StatTile label="Fill rate" value={k ? `${k.fillRatePercent}%` : '—'} tone="good" loading={loading} to={to('C-Vacancies')} />
            <StatTile label="Time to fill" value={k?.averageDaysToFill !== null && k?.averageDaysToFill !== undefined ? `${k.averageDaysToFill} days` : '—'} tone="gold" loading={loading} />
 <StatTile
              label={pnl.data && pnl.data.profit.profitPaise < 0 ? 'Loss (see Expenses)' : 'Profit / loss (see Expenses)'}
              value={pnl.data ? formatINR(pnl.data.profit.profitPaise) : '—'}
              tone={pnl.data && pnl.data.profit.profitPaise < 0 ? 'red' : 'good'}
              loading={!week && pnl.isPending}
              to={to('C-Expenses')}
            />
            <StatTile label="Cost per placement" value={pnl.data?.profit.costPerPlacementPaise !== null && pnl.data?.profit.costPerPlacementPaise !== undefined ? formatINR(pnl.data.profit.costPerPlacementPaise) : '—'} tone="orange" loading={!week && pnl.isPending} to={to('C-Expenses')} />
            <StatTile label="Refunds as % of revenue" value={k ? `${k.refundsPercentOfRevenue}%` : '—'} tone="red" loading={loading} to={to('C-Payments-Out')} />
          </StatGrid>
          {loading || !d ? (
            <div className="two-col">
              <SkeletonCard height={220} />
              <SkeletonCard height={220} />
            </div>
          ) : (
            <>
              <div className="two-col">
                <Card title="Net revenue by month (₹ lakh)">
                  <Bars items={d.monthly.map((m) => ({ label: monthName(m.month), value: m.netPaise }))} format={(n) => (n / 1_00_00_000).toFixed(1)} />
                </Card>
                <Card title={`Funnel · ${label}`}>
                  <Kv rows={funnelRows} />
                </Card>
              </div>
              <Card flush>
                <div className="scrollx">
                  <table>
                    <caption className="sr-only">Where people came from</caption>
                    <thead>
                      <tr>
                        <th scope="col">Where people came from</th>
                        <th scope="col">Registered</th>
                        <th scope="col">Paid ₹499</th>
                        <th scope="col">Placed</th>
                        <th scope="col">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.sources.map((s) => (
                        <tr key={s.source}>
                          <td>{s.source === 'unknown' ? 'Not recorded' : humanize(s.source)}</td>
                          <td>{s.registered}</td>
                          <td>{s.paid}</td>
                          <td>{s.placed}</td>
                          <td>{formatINR(s.revenuePaise)}</td>
                        </tr>
                      ))}
                      {d.sources.length === 0 && (
                        <tr>
                          <td colSpan={5} className="ceo-sub">
                            Nobody registered in this period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="ceo-note" style={{ padding: '8px 16px' }}>
                  From “How did they hear about Laboura?” on every registration — put money where placements come from.
                </div>
              </Card>
              <div className="three-col">
                <Card title="Best areas">
                  <Kv rows={d.bestAreas.map((a, i) => [a.area === 'unknown' ? 'Not recorded' : a.area, `${formatINRCompact(a.revenuePaise)} · ${a.placements}${i === 0 ? ' placements' : ''}`] as [string, string])} />
                  {d.bestAreas.length === 0 && <p className="ceo-sub">No placement fees in this period.</p>}
                </Card>
                <Card title="Trades to recruit">
                  <Kv rows={d.tradesToRecruit.map((t) => [t.trade, `${t.open} open · ${t.pool} in pool`] as [string, string])} />
                  {d.tradesToRecruit.length === 0 && <p className="ceo-sub">No open vacancies.</p>}
                </Card>
                <Card title={`Cohort: paid in ${monthName(d.cohort.month)} (${d.cohort.size})`}>
                  <Kv
                    rows={[
                      ['Placed within 30 days', `${d.cohort.placedWithinGuaranteePercent}%`],
                      ['Refunded', `${d.cohort.refundedPercent}%`],
                      ['Still looking', `${d.cohort.stillLookingPercent}%`],
                      ['Deactivated (3 hits)', `${d.cohort.deactivatedPercent}%`],
                    ]}
                  />
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
