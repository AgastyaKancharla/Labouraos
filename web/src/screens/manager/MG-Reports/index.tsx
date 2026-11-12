import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { downloadTextFile, toCsv } from '../../../lib/csv';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { htmlTable, printDocument } from '../../ceo/_kit/kit';
import { KeptReportsBar, TeamWeeks, WEEK_HEADERS, WeekTable, useKeptReport, weekCells, type WeekRow, type WeeklyResponse } from '../_kit/weekly';

/**
 * Weekly reports — design MG-Reports.dc.html, on GET /manager/reports/weekly:
 * how the Manager's teams did each week against plan, ready to download
 * (Excel/CSV, or PDF through the browser's print). Counts only. With
 * ?week=yyyy-mm-dd (the Monday bell's link) it opens the report kept that
 * Monday (GET /weekly-reports/:week) as it was sent.
 */
export default function WeeklyReports() {
  const to = useScreenPath();
  const now = useNow();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const week = params.get('week');
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const range = periodToUtcRange(period);
  const live = useQuery({ queryKey: ['manager', 'weekly', range], queryFn: () => api.get<WeeklyResponse>('/manager/reports/weekly', { query: range }), enabled: !week });
  const kept = useKeptReport(week);
  const q = week ? kept : live;
  const d: WeeklyResponse | undefined = week ? kept.data?.content : live.data;
  const openWeek = (w: string | null) => setParams(w ? { week: w } : {});

  const excel = () => {
    if (!d) return;
    downloadTextFile(
      week ? `weekly-report-${week}.csv` : `weekly-report-${period.from}-${period.to}.csv`,
      toCsv(d.rows, WEEK_HEADERS.map((h, i) => ({ header: h, value: (r: WeekRow) => weekCells(r)[i] }))),
    );
    toast.success(`Downloaded ${d.rows.length} week${d.rows.length === 1 ? '' : 's'}`);
  };
  const pdf = () => {
    if (!d) return;
    const ok = printDocument('Weekly team report', `<h1>Weekly team report${week && kept.data ? ` · ${kept.data.label}` : ''}</h1><p>Counts only.</p>${htmlTable(WEEK_HEADERS, d.rows.map(weekCells))}`);
    if (!ok) toast.error('Allow pop-ups to make the PDF');
  };

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('MG-Home'), label: 'Command Center' }}
        title="Weekly reports"
        subtitle="How your teams did each week against plan — ready to download or send."
        period={period}
        onPeriodChange={(p) => {
          setPeriod(p);
          if (week) openWeek(null);
        }}
        actions={
          <>
            <Button onClick={excel} disabled={!d}>
              Download (Excel)
            </Button>
            <Button onClick={pdf} disabled={!d}>
              Download (PDF)
            </Button>
          </>
        }
      />
      <KeptReportsBar week={week} onWeek={openWeek} sentAt={kept.data?.sentAt} />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <WeekTable rows={d?.rows} loading={q.isPending} note="Counts only · sent to you and the CEO every Monday at 9 AM · weekly target = a week's share of the month's placement target" />
          <TeamWeeks teams={d?.teams} when={week && kept.data ? kept.data.label : 'last week'} />
        </>
      )}
    </div>
  );
}
