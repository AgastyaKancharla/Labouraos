import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { downloadTextFile, toCsv } from '../../../lib/csv';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { hm, timeOrDash } from '../../ceo/_kit/format';
import { roleTeam, teamShort } from '../_kit/kit';
import { AttendanceTabs } from '../_kit/tabs';

interface Row {
  staff: { id: string; code: string; name: string; role: string; isIntern: boolean };
  team: string | null;
  dayId: string | null;
  loginAt: string | null;
  logoutAt: string | null;
  dayType: string | null;
  countsAs: string | null;
  change: { at: string; reason: string | null } | null;
  productionSeconds: number;
  lateMinutes: number;
  lateDays: number;
  fullDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  lostSeconds: number;
}
interface AttendanceResponse {
  from: string;
  to: string;
  singleDay: boolean;
  rows: Row[];
  summary: { people: number; atWork: number | null; lateLogins: number; missing: number; lostSeconds: number; lostTodaySeconds: number; lostThisWeekSeconds: number };
}

function countsTone(text: string | null): StatusTone {
  if (!text) return 'muted';
  if (/absent|not logged/i.test(text)) return 'danger';
  if (/short|late|half/i.test(text)) return 'warn';
  if (/leave|holiday|off/i.test(text)) return 'info';
  if (/working/i.test(text)) return 'blue';
  return 'good';
}

/**
 * Attendance · today — design MG-Attendance.dc.html, on GET /manager/attendance:
 * everyone in the Manager's teams, login, production, late minutes and how the
 * day counts, with "Change day…" (POST /attendance/days/:dayId/day-type, needs
 * a reason, kept in the history). A longer period shows totals.
 */
export default function ManagerAttendance() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const now = useNow();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>(() => periodFor('today', now));
  const range = periodToUtcRange(period);
  const q = useQuery({ queryKey: ['manager', 'attendance', range], queryFn: () => api.get<AttendanceResponse>('/manager/attendance', { query: range }) });
  const d = q.data;
  const s = d?.summary;
  const single = d?.singleDay ?? period.from === period.to;

  const name: Column<Row> = {
    key: 'name',
    header: 'Name',
    cell: (r) => (
      <div>
        <div style={{ fontWeight: 600 }}>{r.staff.name}</div>
        <div className="ceo-cell-sub">{roleTeam(r.staff.role, r.team, r.staff.isIntern)}</div>
      </div>
    ),
    filter: 'text',
    filterValue: (r) => `${r.staff.name} ${r.staff.code}`,
    sortValue: (r) => r.staff.name,
    csv: (r) => r.staff.name,
  };
  const team: Column<Row> = { key: 'team', header: 'Team', cell: (r) => teamShort(r.team), filter: 'select', filterValue: (r) => teamShort(r.team), csv: (r) => r.team, hideOnPhone: true };
  const dayColumns: Column<Row>[] = [
    name,
    team,
    { key: 'login', header: 'Login', cell: (r) => <span>{timeOrDash(r.loginAt)}{r.lateMinutes ? <span className="ceo-cell-sub"> · {r.lateMinutes} min late</span> : null}</span>, sortValue: (r) => r.loginAt ?? '', csv: (r) => r.loginAt },
    { key: 'prod', header: 'Production', cell: (r) => (r.loginAt ? hm(r.productionSeconds) : '—'), sortValue: (r) => r.productionSeconds, csv: (r) => Math.round(r.productionSeconds / 60) },
    { key: 'show', header: 'Show', cell: (r) => <StatusPill tone={countsTone(r.countsAs)}>{r.countsAs ?? '—'}</StatusPill>, filter: 'select', filterValue: (r) => (r.lateMinutes ? 'Late' : r.countsAs && /absent|not logged/i.test(r.countsAs) ? 'Missing' : r.countsAs && /short|half/i.test(r.countsAs) ? 'Short days' : 'Everyone else'), csv: (r) => r.countsAs },
    {
      key: 'change',
      header: 'Change day',
      cell: (r) =>
        r.dayId ? (
          <span onClick={(e) => e.stopPropagation()}>
            <ActionButton
              label="Change day…"
              title={`Change ${r.staff.name}'s day`}
              description="The change and its reason are kept in the history; the person and their Team Lead see it."
              choice={{ label: 'Counts as', options: [{ value: 'full', label: 'Full day' }, { value: 'half', label: 'Half day' }, { value: 'absent', label: 'Absent' }] }}
              reason
              run={({ choice, reason }) => api.post(`/attendance/days/${r.dayId}/day-type`, { dayType: choice, reason })}
              success="Day changed"
              confirmLabel="Change"
            />
          </span>
        ) : (
          '—'
        ),
    },
  ];
  const rangeColumns: Column<Row>[] = [
    name,
    team,
    { key: 'days', header: 'Full · half', cell: (r) => `${r.fullDays} · ${r.halfDays}`, sortValue: (r) => r.fullDays + r.halfDays / 2, csv: (r) => `${r.fullDays} full, ${r.halfDays} half` },
    { key: 'prod', header: 'Production', cell: (r) => hm(r.productionSeconds), sortValue: (r) => r.productionSeconds, csv: (r) => Math.round(r.productionSeconds / 60) },
    { key: 'late', header: 'Late logins', cell: (r) => (r.lateDays ? `${r.lateDays} · ${r.lateMinutes} min` : '—'), sortValue: (r) => r.lateMinutes, csv: (r) => r.lateMinutes },
    { key: 'lost', header: 'Work time lost', cell: (r) => hm(r.lostSeconds), sortValue: (r) => r.lostSeconds, csv: (r) => Math.round(r.lostSeconds / 60) },
    { key: 'absent', header: 'Absent', cell: (r) => (r.absentDays ? <StatusPill tone="danger">{`${r.absentDays} absent`}</StatusPill> : '—'), sortValue: (r) => r.absentDays, csv: (r) => r.absentDays },
  ];

  const downloadMonth = async () => {
    try {
      const month = periodFor('month', now);
      const res = await api.get<AttendanceResponse>('/manager/attendance', { query: periodToUtcRange(month) });
      downloadTextFile(
        `attendance-${month.from.slice(0, 7)}.csv`,
        toCsv(res.rows, [
          { header: 'Name', value: (r) => r.staff.name },
          { header: 'Staff code', value: (r) => r.staff.code },
          { header: 'Team', value: (r) => r.team },
          { header: 'Full days', value: (r) => r.fullDays },
          { header: 'Half days', value: (r) => r.halfDays },
          { header: 'Leave days', value: (r) => r.leaveDays },
          { header: 'Absent days', value: (r) => r.absentDays },
          { header: 'Late logins', value: (r) => r.lateDays },
          { header: 'Late minutes', value: (r) => r.lateMinutes },
          { header: 'Production minutes', value: (r) => Math.round(r.productionSeconds / 60) },
          { header: 'Work time lost (minutes)', value: (r) => Math.round(r.lostSeconds / 60) },
        ]),
      );
      toast.success(`Downloaded ${res.rows.length} rows`);
    } catch {
      toast.error('Download failed. Try again.');
    }
  };

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Home'), label: 'Command Center' }} title="Attendance · today" subtitle="Everyone in your teams: login, production, late minutes and how the day counts." period={period} onPeriodChange={setPeriod} />
      <AttendanceTabs />
      <StatGrid>
        <StatTile label="At work" value={s ? (s.atWork === null ? s.people : `${s.atWork} / ${s.people}`) : '—'} tone="good" loading={q.isPending} to={to('MG-Attendance-Live')} />
        <StatTile label="Late logins" value={s?.lateLogins ?? '—'} tone="gold" loading={q.isPending} />
        <StatTile label="Missing" value={s?.missing ?? '—'} tone="red" loading={q.isPending} />
        <StatTile label={single ? 'Production lost today' : 'Production lost in this period'} value={s ? hm(single ? s.lostTodaySeconds : s.lostSeconds) : '—'} tone="orange" loading={q.isPending} />
        <StatTile label="Lost this week" value={s ? hm(s.lostThisWeekSeconds) : '—'} tone="orange" loading={q.isPending} />
      </StatGrid>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable
          key={single ? 'day' : 'range'}
          columns={single ? dayColumns : rangeColumns}
          rows={d?.rows}
          rowKey={(r) => r.staff.id}
          caption="Attendance"
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          download={`attendance-${period.from}-${period.to}`}
          emptyTitle="Nobody in your teams marks attendance yet."
          onRowClick={(r) => (r.staff.role === 'call_agent' || r.staff.role === 'field_agent' ? navigate(to('MG-Agent', { id: r.staff.id })) : r.staff.role === 'team_lead' ? navigate(to('MG-TL', { id: r.staff.id })) : undefined)}
        />
        <div className="ceo-note">Full day = 8 production hours, half day under 4.5, with the 5–10 minute tolerance · changing a day needs a reason and is kept in the history</div>
        <div className="ceo-actions" style={{ marginTop: 12 }}>
          <Button onClick={() => void downloadMonth()}>Download month (Excel)</Button>
        </div>
      </div>
    </div>
  );
}
