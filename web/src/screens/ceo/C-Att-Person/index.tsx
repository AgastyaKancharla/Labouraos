import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { DataTable, type Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { addDaysToKey, formatDayMonthIST, istDateKey, istStartOfDay } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { hm, roleLabel, timeOrDash } from '../_kit/format';
import { AttendanceTabs } from '../_kit/tabs';

/** Attendance · one person — design C-Att-Person.dc.html. Any person, any dates (up to 92 days). */
interface Day {
  id: string;
  date: string;
  dayType: string;
  loginAt: string | null;
  logoutAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakOverSeconds: number;
  idleSeconds: number;
  shortfallSeconds: number;
  makeUpSeconds: number;
  hoursLostSeconds: number;
  leaveKind: string | null;
  change: { byStaffId: string | null; at: string; reason: string | null } | null;
}
interface Report {
  staff: { id: string; code: string; name: string; role: string };
  from: string;
  to: string;
  lateLogins: { count: number; days: { date: string; minutes: number }[] };
  days: Day[];
  totals: { productionSeconds: number; hoursLostSeconds: number; lateLogins: number; absentDays: number; shortfallSeconds: number; makeUpSeconds: number };
}
interface Balance {
  casual: { left: number };
  emergency: { left: number };
}
interface TeamLite {
  rows: { id: string; name: string; role: string; state: string }[];
}

const FULL_DAY_SECONDS = 8 * 3600;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabel(key: string) {
  const d = istStartOfDay(key);
  return `${WEEKDAY[new Date(`${key}T00:00:00Z`).getUTCDay()]} ${formatDayMonthIST(d).split(' ')[0]}`;
}

function countsAs(d: Day): string {
  if (d.change) return `Changed to ${d.dayType === 'half' ? 'half' : 'full'} day${d.change.reason ? ` · ${d.change.reason}` : ''}`;
  if (d.dayType === 'absent') return 'Absent · no leave';
  if (d.dayType === 'leave') return `${d.leaveKind ? d.leaveKind.charAt(0).toUpperCase() + d.leaveKind.slice(1) : 'Paid'} leave`;
  if (d.dayType === 'half') return 'Half day';
  if (d.dayType === 'full') return d.shortfallSeconds > d.makeUpSeconds ? 'Short · make-up owed' : d.lateMinutes ? 'Full day (tolerance)' : 'Full day';
  return d.dayType.replace(/_/g, ' ');
}

export default function AttendancePerson() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const { staffId = '' } = useParams();
  const today = istDateKey(useNow());
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [toDate, setTo] = useState(today);
  const report = useQuery({ queryKey: ['attendance', 'report', staffId, from, toDate], queryFn: () => api.get<Report>('/attendance/report', { query: { staffId, from, to: toDate } }), enabled: Boolean(staffId) });
  const balance = useQuery({ queryKey: ['attendance', 'balance', staffId], queryFn: () => api.get<Balance>('/attendance/leave/balance', { query: { staffId } }), enabled: Boolean(staffId) });
  const team = useQuery({ queryKey: ['ceo', 'team'], queryFn: () => api.get<TeamLite>('/ceo/team') });
  const r = report.data;
  const worked = r ? r.days.filter((d) => d.loginAt).length : 0;
  const lateMinutes = r ? r.lateLogins.days.reduce((s, x) => s + x.minutes, 0) : 0;
  const people = (team.data?.rows ?? []).filter((p) => p.role !== 'ceo' && p.state !== 'deactivated');

  const columns: Column<Day>[] = [
    { key: 'day', header: 'Day', cell: (d) => dayLabel(d.date), sortValue: (d) => d.date, csv: (d) => d.date },
    { key: 'login', header: 'Login', cell: (d) => timeOrDash(d.loginAt), csv: (d) => d.loginAt },
    { key: 'late', header: 'Late login', cell: (d) => (d.lateMinutes ? `${d.lateMinutes} min` : '—'), csv: (d) => d.lateMinutes },
    { key: 'prod', header: 'Production', cell: (d) => (d.loginAt ? hm(d.productionSeconds) : '—'), sortValue: (d) => d.productionSeconds, csv: (d) => Math.round(d.productionSeconds / 60) },
    { key: 'breaks', header: 'Breaks over', cell: (d) => hm(d.breakOverSeconds), csv: (d) => Math.round(d.breakOverSeconds / 60), hideOnPhone: true },
    { key: 'lost', header: 'Lost', cell: (d) => (d.hoursLostSeconds ? hm(d.hoursLostSeconds) : '—'), csv: (d) => Math.round(d.hoursLostSeconds / 60) },
    { key: 'counts', header: 'Counts as', cell: (d) => <StatusPill tone={d.dayType === 'absent' ? 'danger' : d.change ? 'info' : /short|half/i.test(countsAs(d)) ? 'warn' : 'good'}>{countsAs(d)}</StatusPill>, filter: 'select', filterValue: (d) => countsAs(d).split(' · ')[0], csv: (d) => countsAs(d) },
    {
      key: 'change',
      header: '',
      cell: (d) =>
        ['full', 'half', 'absent'].includes(d.dayType) ? (
          <ActionButton
            label="Change day"
            title={`Change ${dayLabel(d.date)}`}
            description="When something went wrong (system down, a call that ran over). The change and the reason are kept in the day's history."
            choice={{ label: 'Counts as', options: [{ value: 'full', label: 'Full day' }, { value: 'half', label: 'Half day' }], initial: d.dayType === 'full' ? 'half' : 'full' }}
            reason
            run={({ choice, reason }) => api.post(`/attendance/days/${d.id}/day-type`, { dayType: choice, reason })}
            success="Day changed"
          />
        ) : null,
    },
  ];

  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('C-Team-Attendance'), label: 'Attendance' }}
        title={`Attendance · ${r?.staff.name ?? '…'}`}
        subtitle="Every late login, production day by day and hours lost, for any person and dates."
      />
      <AttendanceTabs personId={staffId} />
      <div className="panel ceo-filters">
        <span className="ceo-grow" style={{ alignSelf: 'center' }}>
          Showing <strong>{r?.staff.name ?? '…'}</strong>
          {r ? ` · ${roleLabel(r.staff.role).toLowerCase()}` : ''}
        </span>
        <label className="field">
          From
          <input type="date" value={from} max={toDate} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="field">
          to
          <input type="date" value={toDate} min={from} max={addDaysToKey(from, 91)} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <label className="field">
          Pick another person →
          <select aria-label="Pick another person" value={staffId} onChange={(e) => navigate(to('C-Att-Person', { staffId: e.target.value }))}>
            {!people.some((p) => p.id === staffId) && <option value={staffId}>{r?.staff.name ?? '…'}</option>}
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {roleLabel(p.role)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {report.error ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatTile label="Late logins" value={r ? `${r.lateLogins.count} days · ${lateMinutes} min` : '—'} tone="gold" loading={report.isPending} />
            <StatTile label={`Production of ${worked * 8}h`} value={r ? hm(r.totals.productionSeconds) : '—'} tone="royal" loading={report.isPending} detail={r && worked ? `${Math.round((r.totals.productionSeconds * 100) / (worked * FULL_DAY_SECONDS))}%` : undefined} />
            <StatTile label="Production lost" value={r ? hm(r.totals.hoursLostSeconds) : '—'} tone="orange" loading={report.isPending} />
            <StatTile label="Leave balance" value={balance.data ? `${balance.data.casual.left + balance.data.emergency.left} days` : '—'} tone="good" loading={balance.isPending} detail={balance.data ? `${balance.data.casual.left} casual · ${balance.data.emergency.left} emergency` : undefined} />
          </StatGrid>
          <div className="panel" style={{ padding: '6px 18px 14px' }}>
            <DataTable columns={columns} rows={r?.days} rowKey={(d) => d.id} caption="Days" loading={report.isPending} download={`attendance-${r?.staff.code ?? staffId}-${from}-${toDate}`} emptyTitle="No attendance days in these dates." />
          </div>
        </>
      )}
    </div>
  );
}
