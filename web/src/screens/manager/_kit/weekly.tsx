import './manager.css';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { StatusPill } from '../../../components/Badge';
import { SelectField } from '../../../components/fields';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST, formatDayMonthIST } from '../../../lib/format/date';
import { hm } from '../../ceo/_kit/format';

/**
 * The weekly report pieces shared by MG-Reports (live and kept weeks) and
 * C-Reports (the kept company report): the week rows, each team's week, and
 * the picker for the reports kept every Monday at 9 AM (GET /weekly-reports).
 */
export interface WeekRow {
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
export interface TeamWeek {
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
}
export interface WeeklyResponse {
  rows: WeekRow[];
  lastWeek: { from: string; to: string };
  teams: TeamWeek[];
}
export interface KeptReport<C = WeeklyResponse> {
  week: string;
  end: string;
  label: string;
  sentAt: string;
  content: C & { week: { start: string; end: string; label: string } };
}
export interface KeptListItem {
  week: string;
  end: string;
  label: string;
  sentAt: string;
}

export function weekLabel(r: WeekRow): string {
  return `${formatDayMonthIST(r.from)} – ${formatDayMonthIST(r.to)}`;
}

export const WEEK_HEADERS = ['Week', 'Registrations', 'Paid', 'Businesses', 'Interviews', 'Placements', 'Attendance', 'Work time lost', 'Weekly target'];
export function weekCells(r: WeekRow): (string | number)[] {
  return [weekLabel(r), r.registered, r.paid, r.businessesSignedUp, r.interviewsDone, r.placed, r.attendancePercent === null ? '—' : `${r.attendancePercent}%`, hm(r.lostSeconds), r.reached === null ? 'No target' : r.reached ? 'Reached' : 'Short'];
}

export const useKeptReports = () => useQuery({ queryKey: ['weekly-reports'], queryFn: () => api.get<KeptListItem[]>('/weekly-reports') });
export function useKeptReport<C = WeeklyResponse>(week: string | null) {
  return useQuery({ queryKey: ['weekly-reports', week], queryFn: () => api.get<KeptReport<C>>(`/weekly-reports/${encodeURIComponent(week ?? '')}`), enabled: Boolean(week) });
}

export function WeekTable({ rows, loading, note }: { rows: WeekRow[] | undefined; loading?: boolean; note: string }) {
  return (
    <Card>
      <div className="scrollx">
        <table>
          <thead>
            <tr>
              {WEEK_HEADERS.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={WEEK_HEADERS.length}>
                  <span className="lb-skeleton" style={{ height: 18, width: '40%', display: 'block' }} aria-hidden="true" />
                </td>
              </tr>
            )}
            {rows?.map((r) => (
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
      <div className="mg-note">{note}</div>
    </Card>
  );
}

export function TeamWeeks({ teams, when }: { teams: TeamWeek[] | undefined; when: string }) {
  if (!teams?.length) return null;
  return (
    <div className="two-col">
      {teams.map((t) => (
        <Card key={t.teamLeadId} title={`${t.team} · ${when}`}>
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
  );
}

/**
 * "Monday reports": pick a kept week to open it as it was sent, or go back to
 * the live numbers. `week` is the open week (yyyy-mm-dd of its Monday) or null.
 */
export function KeptReportsBar({ week, onWeek, sentAt }: { week: string | null; onWeek: (week: string | null) => void; sentAt?: string }) {
  const kept = useKeptReports();
  const options = (kept.data ?? []).map((r) => ({ value: r.week, label: `${r.label} · sent ${formatDateTimeIST(r.sentAt)}` }));
  if (week && !options.some((o) => o.value === week)) options.unshift({ value: week, label: week });
  return (
    <section className="panel mg-filters" aria-label="Kept weekly reports">
      <SelectField label="Monday reports" value={week ?? ''} onChange={(v) => onWeek(v || null)} placeholder={kept.data && !kept.data.length ? 'None kept yet' : 'Live numbers'} options={options} />
      <div className="mg-grow" style={{ alignSelf: 'center' }}>
        {week ? (
          <span className="ceo-sub">
            The report as it was sent{sentAt ? ` on ${formatDateTimeIST(sentAt)}` : ''} · counts as they stood then{' '}
            <Button onClick={() => onWeek(null)}>Back to live numbers</Button>
          </span>
        ) : (
          <span className="ceo-sub">Each Monday at 9 AM last week's report is sent with a bell and kept here</span>
        )}
      </div>
    </section>
  );
}
