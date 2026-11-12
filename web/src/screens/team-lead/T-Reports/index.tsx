import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { TopBar } from '../../../components/TopBar';
import { Kv } from '../../ceo/_kit/kit';
import { hm } from '../../ceo/_kit/format';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { periodFor, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { firstName, useTeam } from '../_kit/api';

/** Reports — design T-Reports.dc.html: the team's day and week, counts only. */
interface DayRow {
  date: string;
  soFar: boolean;
  calls: number;
  registered: number;
  paid: number;
  visits: number;
  interviews: number;
  atWork: number;
  people: number;
  secondsLost: number;
}
interface Week {
  from: string;
  to: string;
  placed: number;
  paid: number;
  attendancePercent: number | null;
  lateLogins: number;
  best: { staff: { name: string }; paid: number } | null;
}
interface Report {
  rows: DayRow[];
  thisWeek: Week;
  lastWeek: Week;
}

const day = (ymd: string) => formatDateIST(`${ymd}T06:00:00Z`);

export default function TeamLeadReports() {
  const to = useScreenPath();
  const now = useNow();
  const team = useTeam();
  const [period, setPeriod] = useState<Period>(() => periodFor('week', now));
  const report = useQuery({ queryKey: ['team-lead', 'reports', period.from, period.to], queryFn: () => api.get<Report>('/team-lead/reports', { query: { from: period.from, to: period.to } }) });
  const r = report.data;
  const mgr = team.data?.manager ? firstName(team.data.manager.name) : 'the Manager';
  const columns: Column<DayRow>[] = [
    { key: 'day', header: 'Day', cell: (d) => `${day(d.date)}${d.soFar ? ' (so far)' : ''}`, sortValue: (d) => d.date, csv: (d) => d.date },
    { key: 'calls', header: 'Calls', cell: (d) => d.calls, csv: (d) => d.calls },
    { key: 'reg', header: 'Registered', cell: (d) => d.registered, csv: (d) => d.registered },
    { key: 'paid', header: 'Paid the ₹499 fee', cell: (d) => d.paid, csv: (d) => d.paid },
    { key: 'visits', header: 'Shop visits', cell: (d) => d.visits, csv: (d) => d.visits },
    { key: 'int', header: 'Interviews', cell: (d) => d.interviews, csv: (d) => d.interviews },
    { key: 'work', header: 'At work', cell: (d) => `${d.atWork} of ${d.people}`, csv: (d) => d.atWork },
    { key: 'lost', header: 'Work time lost', cell: (d) => hm(d.secondsLost), csv: (d) => Math.round(d.secondsLost / 60) },
  ];
  const week = (w: Week | undefined, label: string): [string, string][] =>
    w
      ? [
          ['People placed', String(w.placed)],
          ['Paid the ₹499 fee', String(w.paid)],
          ['Attendance', w.attendancePercent === null ? '—' : `${w.attendancePercent}%`],
          ['Late logins', String(w.lateLogins)],
          [label, w.best ? `${w.best.staff.name} · ${w.best.paid} paid` : '—'],
        ]
      : [];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Reports" subtitle={`Your team's day and week, ready to send to ${mgr}.`} period={period} onPeriodChange={setPeriod} />
      <Card flush>
        <DataTable columns={columns} rows={r?.rows} rowKey={(d) => d.date} caption="Team report by day" loading={report.isPending} error={report.error} onRetry={() => void report.refetch()} download="team-report" emptyTitle="No days in this range." />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          Counts only, no names or phone numbers · downloads are for Managers and the CEO (nobody below Manager downloads lists) · {mgr} sees the same numbers
        </div>
      </Card>
      <div className="two-col">
        <Card title="This week so far">
          <Kv rows={week(r?.thisWeek, 'Best')} />
        </Card>
        <Card title="Last week">
          <Kv rows={week(r?.lastWeek, 'Best')} />
        </Card>
      </div>
    </div>
  );
}
