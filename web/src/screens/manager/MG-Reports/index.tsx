import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { downloadTextFile, toCsv } from '../../../lib/csv';
import { formatDayMonthIST } from '../../../lib/format/date';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { hm } from '../../ceo/_kit/format';
import { htmlTable, printDocument } from '../../ceo/_kit/kit';

interface WeekRow {
  from: string;
  to: string;
  startDay: string;
  registered: number;
  paid: number;
  businessesSignedUp: number;
  interviewsDone: number;
  placed: number;
  attendancePercent: number | null;
  lostSeconds: number;
  placementTarget: number | null;
  reached: boolean | null;
}
interface WeeklyResponse {
  rows: WeekRow[];
  lastWeek: { from: string; to: string };
  teams: {
    teamLeadId: string;
    team: string;
    teamLead: string;
    placed: number;
    placementPlan: number | null;
    paid: number;
    attendancePercent: number | null;
    lateLogins: number;
    best: { staff: { id: string; name: string }; placed: number; paid: number } | null;
    needsHelp: { staff: { id: string; name: string }; placed: number; paid: number } | null;
  }[];
}

function weekLabel(r: WeekRow): string {
  return `${formatDayMonthIST(r.from)} – ${formatDayMonthIST(r.to)}`;
}

const HEADERS = ['Week', 'Registrations', 'Paid', 'Businesses', 'Interviews', 'Placements', 'Attendance', 'Work time lost', 'Weekly target'];
function cells(r: WeekRow): (string | number)[] {
  return [weekLabel(r), r.registered, r.paid, r.businessesSignedUp, r.interviewsDone, r.placed, r.attendancePercent === null ? '—' : `${r.attendancePercent}%`, hm(r.lostSeconds), r.reached === null ? 'No target' : r.reached ? 'Reached' : 'Short'];
}

/**
 * Weekly reports — design MG-Reports.dc.html, on GET /manager/reports/weekly:
 * how the Manager's teams did each week against plan, ready to download
 * (Excel/CSV, or PDF through the browser's print). Counts only.
 */
export default function WeeklyReports() {
  const to = useScreenPath();
  const now = useNow();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const range = periodToUtcRange(period);
  const q = useQuery({ queryKey: ['manager', 'weekly', range], queryFn: () => api.get<WeeklyResponse>('/manager/reports/weekly', { query: range }) });
  const d = q.data;

  const excel = () => {
    if (!d) return;
    downloadTextFile(
      `weekly-report-${period.from}-${period.to}.csv`,
      toCsv(d.rows, HEADERS.map((h, i) => ({ header: h, value: (r: WeekRow) => cells(r)[i] }))),
    );
    toast.success(`Downloaded ${d.rows.length} weeks`);
  };
  const pdf = () => {
    if (!d) return;
    const ok = printDocument('Weekly team report', `<h1>Weekly team report</h1><p>Counts only.</p>${htmlTable(HEADERS, d.rows.map(cells))}`);
    if (!ok) toast.error('Allow pop-ups to make the PDF');
  };

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('MG-Home'), label: 'Command Center' }}
        title="Weekly reports"
        subtitle="How your teams did each week against plan — ready to download or send."
        period={period}
        onPeriodChange={setPeriod}
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
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Card>
            <div className="scrollx">
              <table>
                <thead>
                  <tr>
                    {HEADERS.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.isPending && (
                    <tr>
                      <td colSpan={HEADERS.length}>
                        <span className="lb-skeleton" style={{ height: 18, width: '40%', display: 'block' }} aria-hidden="true" />
                      </td>
                    </tr>
                  )}
                  {d?.rows.map((r) => (
                    <tr key={r.from}>
                      <td>{weekLabel(r)}</td>
                      <td>{r.registered}</td>
                      <td>{r.paid}</td>
                      <td>{r.businessesSignedUp}</td>
                      <td>{r.interviewsDone}</td>
                      <td>{r.placed}</td>
                      <td>{r.attendancePercent === null ? '—' : `${r.attendancePercent}%`}</td>
                      <td>{hm(r.lostSeconds)}</td>
                      <td>{r.reached === null ? <StatusPill tone="muted">No target</StatusPill> : <StatusPill tone={r.reached ? 'good' : 'danger'}>{r.reached ? 'Reached' : 'Short'}</StatusPill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mg-note">Counts only · weekly target = a week's share of the month's placement target</div>
          </Card>
          <div className="two-col">
            {d?.teams.map((t) => (
              <Card key={t.teamLeadId} title={`${t.team} · last week`}>
                <div className="mg-kv-list">
                  <span>Placements</span>
                  <span>
                    {t.placed}
                    {t.placementPlan !== null ? ` (plan ${t.placementPlan})` : ''}
                  </span>
                  <span>Paid registrations</span>
                  <span>{t.paid}</span>
                  <span>Attendance</span>
                  <span>{t.attendancePercent === null ? '—' : `${t.attendancePercent}%`}</span>
                  <span>Late logins</span>
                  <span>{t.lateLogins}</span>
                  <span>Best</span>
                  <span>{t.best ? `${t.best.staff.name} · ${t.best.placed} placements, ${t.best.paid} paid` : '—'}</span>
                  <span>Needs help</span>
                  <span>{t.needsHelp ? `${t.needsHelp.staff.name} · ${t.needsHelp.placed} placements, ${t.needsHelp.paid} paid` : '—'}</span>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
