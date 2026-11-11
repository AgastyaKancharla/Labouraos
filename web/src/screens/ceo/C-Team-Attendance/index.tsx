import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ButtonLink } from '../../../components/Button';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { hm, roleLabel, timeOrDash } from '../_kit/format';
import { AttendanceTabs } from '../_kit/tabs';

/** Attendance — design C-Team-Attendance.dc.html. One day shows each person's day; a longer period shows totals. */
interface Row {
  staff: { id: string; code: string; name: string; role: string; team: string | null };
  loginAt: string | null;
  logoutAt: string | null;
  dayType: string | null;
  countsAs: string | null;
  productionSeconds: number;
  breakSeconds: number;
  lateMinutes: number;
  lateDays: number;
  fullDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  shortfallSeconds: number;
}
interface AttendanceResponse {
  from: string;
  to: string;
  singleDay: boolean;
  policy: { shiftStart: string; shiftEnd: string; productionHoursFullDay: number; halfDayBelowHours: number; dayToleranceMinutes: number; lateGraceMinutes: number };
  rows: Row[];
  summary: { people: number; loggedInToday: number; lateLogins: number; absent: number; makeUpOwedSeconds: number; productionPercent: number | null };
}

function countsTone(text: string | null): StatusTone {
  if (!text) return 'muted';
  if (/absent|not logged/i.test(text)) return 'danger';
  if (/short|late|half/i.test(text)) return 'warn';
  if (/leave|holiday|off/i.test(text)) return 'info';
  return 'good';
}

export default function TeamAttendance() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const now = useNow();
  const [period, setPeriod] = useState<Period>(() => periodFor('today', now));
  const range = periodToUtcRange(period);
  const att = useQuery({ queryKey: ['ceo', 'attendance', range], queryFn: () => api.get<AttendanceResponse>('/ceo/attendance', { query: range }) });
  const d = att.data;
  const s = d?.summary;
  const single = d?.singleDay ?? period.from === period.to;

  const name: Column<Row> = { key: 'staff', header: 'Staff', cell: (r) => <div><div style={{ fontWeight: 600 }}>{r.staff.name}</div><div className="ceo-cell-sub">{roleLabel(r.staff.role)}{r.staff.team ? ` · ${r.staff.team}` : ''}</div></div>, filter: 'text', filterValue: (r) => `${r.staff.name} ${r.staff.code}`, sortValue: (r) => r.staff.name, csv: (r) => r.staff.name };
  const team: Column<Row> = { key: 'team', header: 'Team', cell: (r) => r.staff.team ?? '—', filter: 'select', filterValue: (r) => r.staff.team ?? '—', csv: (r) => r.staff.team, hideOnPhone: true };
  const dayColumns: Column<Row>[] = [
    name,
    team,
    { key: 'login', header: 'Login', cell: (r) => timeOrDash(r.loginAt), sortValue: (r) => r.loginAt ?? '', csv: (r) => r.loginAt },
    { key: 'logout', header: 'Logout', cell: (r) => timeOrDash(r.logoutAt), csv: (r) => r.logoutAt, hideOnPhone: true },
    { key: 'prod', header: 'Production', cell: (r) => (r.loginAt ? hm(r.productionSeconds) : '—'), sortValue: (r) => r.productionSeconds, csv: (r) => Math.round(r.productionSeconds / 60) },
    { key: 'breaks', header: 'Breaks', cell: (r) => (r.loginAt ? hm(r.breakSeconds) : '—'), csv: (r) => Math.round(r.breakSeconds / 60), hideOnPhone: true },
    { key: 'late', header: 'Late login', cell: (r) => (r.lateMinutes ? `${r.lateMinutes} min` : '—'), sortValue: (r) => r.lateMinutes, csv: (r) => r.lateMinutes },
    { key: 'counts', header: 'Counts as', cell: (r) => <StatusPill tone={countsTone(r.countsAs)}>{r.countsAs ?? '—'}</StatusPill>, filter: 'select', filterValue: (r) => r.countsAs ?? '—', csv: (r) => r.countsAs },
  ];
  const rangeColumns: Column<Row>[] = [
    name,
    team,
    { key: 'days', header: 'Full · half', cell: (r) => `${r.fullDays} · ${r.halfDays}`, sortValue: (r) => r.fullDays + r.halfDays / 2, csv: (r) => `${r.fullDays} full, ${r.halfDays} half` },
    { key: 'prod', header: 'Production', cell: (r) => hm(r.productionSeconds), sortValue: (r) => r.productionSeconds, csv: (r) => Math.round(r.productionSeconds / 60) },
    { key: 'late', header: 'Late logins', cell: (r) => (r.lateDays ? `${r.lateDays} · ${r.lateMinutes} min` : '—'), sortValue: (r) => r.lateMinutes, csv: (r) => r.lateMinutes },
    { key: 'short', header: 'Shortfall owed', cell: (r) => (r.shortfallSeconds ? hm(r.shortfallSeconds) : '—'), sortValue: (r) => r.shortfallSeconds, csv: (r) => Math.round(r.shortfallSeconds / 60) },
    { key: 'leave', header: 'Leave', cell: (r) => r.leaveDays || '—', csv: (r) => r.leaveDays, hideOnPhone: true },
    { key: 'absent', header: 'Absent', cell: (r) => (r.absentDays ? <StatusPill tone="danger">{`${r.absentDays} absent`}</StatusPill> : '—'), sortValue: (r) => r.absentDays, csv: (r) => r.absentDays },
  ];
  const p = d?.policy;
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('Main'), label: 'Command Center' }} title="Attendance" subtitle="Everyone's day: login, production, breaks, late logins — and production lost." period={period} onPeriodChange={setPeriod} />
      <AttendanceTabs />
      <StatGrid>
        <StatTile label="Logged in today" value={s ? `${s.loggedInToday} / ${s.people}` : '—'} tone="royal" loading={att.isPending} to={to('C-Att-Live')} />
        <StatTile label="Late logins" value={s?.lateLogins ?? '—'} tone="gold" loading={att.isPending} />
        <StatTile label="Absent" value={s?.absent ?? '—'} tone="red" loading={att.isPending} />
        <StatTile label="Make-up owed (this month)" value={s ? hm(s.makeUpOwedSeconds) : '—'} tone="orange" loading={att.isPending} />
        <StatTile label="Production vs. target" value={s?.productionPercent === null || !s ? '—' : `${s.productionPercent}%`} tone="good" loading={att.isPending} />
      </StatGrid>
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable
          key={single ? 'day' : 'range'}
          columns={single ? dayColumns : rangeColumns}
          rows={d?.rows}
          rowKey={(r) => r.staff.id}
          caption="Attendance"
          loading={att.isPending}
          error={att.error}
          onRetry={() => void att.refetch()}
          download={`attendance-${period.from}-${period.to}`}
          emptyTitle="Nobody marks attendance yet."
          onRowClick={(r) => navigate(to('C-Att-Person', { staffId: r.staff.id }))}
        />
        <div className="ceo-note">
          Times come from Laboura's server · {p ? `${p.productionHoursFullDay} production hours = full day, under ${p.halfDayBelowHours} = half day, ${p.dayToleranceMinutes}-minute tolerance, late after ${p.shiftStart} + ${p.lateGraceMinutes} min` : '8 production hours = full day'} · Team Leads and Managers can change a day with a reason · settings are on Pricing &amp; policy
        </div>
        <div className="ceo-actions" style={{ marginTop: 12 }}>
          {d?.rows[0] && <ButtonLink to={to('C-Att-Person', { staffId: d.rows[0].staff.id })}>One person's report</ButtonLink>}
          <ButtonLink to={to('C-Team-Salaries')}>Download month for salaries</ButtonLink>
        </div>
      </div>
    </div>
  );
}
