import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import AttendanceLive from '../C-Att-Live';
import TeamAttendance from '../C-Team-Attendance';
import AttendancePerson from '../C-Att-Person';
import TeamLeadAttendance from '../../team-lead/T-Attendance';
import { dayChips } from '../../call-agent/CA14e-MyAttendance/chips';
import { attendanceEn } from '../../../attendance/i18n';

/** 17 Nov, item 3: a late login reads in hours and minutes from 60 minutes ("1 h 5 min"), in minutes below. */
const NOW = new Date('2026-11-11T06:30:00Z');
const common = { 'GET /login-codes/pending': [], 'GET /password-resets/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [], 'GET /payroll/corrections': { status: 'waiting', rows: [] }, 'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [] } };
const ceo = (ui: React.ReactElement, path: string, route?: string) => {
  signInAs('ceo');
  return renderScreen(ui, { portal: 'ceo', path, route, now: NOW });
};

describe('late login in hours and minutes (17 Nov)', () => {
  it('C-Team-Attendance: "1 h 5 min" for one day, the period total too', async () => {
    mockApi({
      ...common,
      'GET /ceo/attendance': {
        from: '2026-11-11', to: '2026-11-11', singleDay: true,
        policy: { shiftStart: '09:30', shiftEnd: '18:30', productionHoursFullDay: 8, halfDayBelowHours: 4.5, dayToleranceMinutes: 10, lateGraceMinutes: 10 },
        rows: [
          { staff: { id: 'a', code: 'CA-2', name: 'Arun P', role: 'call_agent', team: 'Team North' }, loginAt: '2026-11-11T05:05:00Z', logoutAt: null, dayType: 'full', countsAs: 'Late · full day', productionSeconds: 26400, breakSeconds: 1800, lateMinutes: 65, lateDays: 1, fullDays: 1, halfDays: 0, absentDays: 0, leaveDays: 0, shortfallSeconds: 0 },
          { staff: { id: 'b', code: 'CA-3', name: 'Deepa N', role: 'call_agent', team: 'Team North' }, loginAt: '2026-11-11T04:57:00Z', logoutAt: null, dayType: 'full', countsAs: 'Late · full day', productionSeconds: 26400, breakSeconds: 1800, lateMinutes: 47, lateDays: 1, fullDays: 1, halfDays: 0, absentDays: 0, leaveDays: 0, shortfallSeconds: 0 },
        ],
        summary: { people: 2, loggedInToday: 2, lateLogins: 2, absent: 0, makeUpOwedSeconds: 0, productionPercent: 91 },
      },
    });
    ceo(<TeamAttendance />, '/ceo/attendance');
    expect(await screen.findByText('1 h 5 min')).toBeInTheDocument();
    expect(screen.getByText('47 min')).toBeInTheDocument();
    expect(screen.queryByText('65 min')).toBeNull();
  });

  it('C-Att-Live: the login time with how late it was', async () => {
    const row = (id: string, name: string, lateMinutes: number) => ({ staff: { id, code: id, name, role: 'call_agent' }, status: 'available', since: '2026-11-11T06:26:00Z', loginAt: '2026-11-11T05:00:00Z', lateMinutes, productionSeconds: 3600, breakSeconds: 0, breakOverSeconds: 0, overBreak: false, idle: false, idleSeconds: 0 });
    mockApi({ ...common, 'GET /attendance/live': { asOf: NOW.toISOString(), counts: {}, people: [row('a', 'Arun P', 60), row('b', 'Deepa N', 47)] } });
    ceo(<AttendanceLive />, '/ceo/attendance/live');
    expect(await screen.findByText(/· 1 h late/)).toBeInTheDocument();
    expect(screen.getByText(/· 47 min late/)).toBeInTheDocument();
  });

  it('C-Att-Person: each day and the month total', async () => {
    mockApi({
      ...common,
      'GET /attendance/report': {
        staff: { id: 'a', code: 'CA-2', name: 'Arun P', role: 'call_agent' }, from: '2026-11-01', to: '2026-11-11',
        lateLogins: { count: 2, days: [{ date: '2026-11-06', minutes: 125 }, { date: '2026-11-07', minutes: 15 }] },
        days: [
          { id: 'd6', date: '2026-11-06', dayType: 'full', loginAt: '2026-11-06T06:05:00Z', logoutAt: '2026-11-06T15:00:00Z', lateMinutes: 125, productionSeconds: 29000, breakOverSeconds: 0, idleSeconds: 0, shortfallSeconds: 0, makeUpSeconds: 0, hoursLostSeconds: 0, leaveKind: null, change: null },
          { id: 'd7', date: '2026-11-07', dayType: 'full', loginAt: '2026-11-07T04:15:00Z', logoutAt: '2026-11-07T13:00:00Z', lateMinutes: 15, productionSeconds: 29000, breakOverSeconds: 0, idleSeconds: 0, shortfallSeconds: 0, makeUpSeconds: 0, hoursLostSeconds: 0, leaveKind: null, change: null },
        ],
        totals: { productionSeconds: 58000, hoursLostSeconds: 0, lateLogins: 2, absentDays: 0, shortfallSeconds: 0, makeUpSeconds: 0 },
      },
      'GET /attendance/leave/balance': { staffId: 'a', casual: { left: 2 }, emergency: { left: 2 } },
      'GET /ceo/team': { rows: [], totals: {}, organisation: { ceos: [], managers: [], teamLeads: [], finance: [] }, reportsToOptions: [] },
    });
    ceo(<AttendancePerson />, '/ceo/attendance/a', '/ceo/attendance/:staffId');
    expect(await screen.findByText('2 days · 2 h 20 min')).toBeInTheDocument();
    expect(screen.getByText('2 h 5 min')).toBeInTheDocument();
    expect(screen.getByText('15 min')).toBeInTheDocument();
  });

  it('T-Attendance (Team Lead): "1 h 5 min late"', async () => {
    const sneha = { id: 'ca-3', code: 'CA-0009', name: 'Sneha K', role: 'call_agent' };
    mockApi({
      'GET /team-lead/team': { lead: { id: 'tl', code: 'TL-1', name: 'Ravi', role: 'team_lead' }, teamName: 'Team South', manager: null, members: [sneha] },
      'GET /login-codes/pending': [],
      'GET /review-flags': [],
      'GET /requests/waiting': [],
      'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [] },
      'GET /team-lead/attendance': { date: '2026-11-11', isToday: true, summary: { atWork: 1, people: 1, late: 1, overBreak: 0, secondsLost: 0 }, rows: [{ staff: sneha, dayId: 'd1', dayType: 'open', loginAt: '2026-11-11T05:05:00Z', lateMinutes: 65, productionSeconds: 1500, breakSeconds: 0, overBreak: false, status: 'available', changesThisMonth: 0 }] },
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadAttendance />, { portal: 'team-lead', path: '/team-lead/attendance', now: NOW });
    expect(await screen.findByText('1 h 5 min late')).toBeInTheDocument();
  });

  it("the agent's own day chip and texts use the same words", () => {
    const chips = dayChips({ date: '2026-11-06', dayType: 'full', lateMinutes: 65, shortfallSeconds: 0, makeUpSeconds: 0 } as Parameters<typeof dayChips>[0]);
    expect(chips[0]).toMatchObject({ key: 'att.day.late', vars: { late: '1 h 5 min' } });
    expect(attendanceEn['att.day.late']).toBe('Late {late}');
    expect(attendanceEn['att.late']).toBe('Late · {late}');
    expect(attendanceEn['att.toast.startedLate']).toContain('{late}');
    expect(attendanceEn['att.ended.lateYes']).toBe('Yes · {late}');
    expect(within(document.body).queryByText(/min min/)).toBeNull();
  });
});
