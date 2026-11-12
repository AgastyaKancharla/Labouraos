import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import Home from '../MG-Home';
import Plan from '../MG-Plan';
import Pipeline from '../MG-Pipeline';
import Agents from '../MG-Agents';
import Agent from '../MG-Agent';
import Teams from '../MG-Teams';
import TeamLead from '../MG-TL';
import Staff from '../MG-Staff';
import Attendance from '../MG-Attendance';
import Leave from '../MG-Leave';
import CallCenter from '../MG-CallCenter';
import FieldOps from '../MG-FieldOps';
import Flags from '../MG-Flags';
import Targets from '../MG-Targets';
import Reports from '../MG-Reports';
import LoginCodes from '../MG-LoginCodes';
import Notifications from '../MG-Notifications';
import Requests from '../MG-Requests';
import Decided from '../MG-Decided';
import RequestDetail from '../MG-Req-Ravi';

const NOW = new Date('2026-11-09T12:30:00Z'); // 18:00 IST, 9 Nov
const common = {
  'GET /login-codes/pending': [],
  'GET /review-flags': [],
  'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: NOW.toISOString() },
};
const render = (ui: React.ReactElement, path: string, route?: string) => {
  signInAs('manager');
  return renderScreen(ui, { portal: 'manager', path, route, now: NOW });
};
const dialog = () => screen.findByRole('dialog');
const f = (done: number, target: number | null, atThisSpeed: number, extra: number | null, verdict: string) => ({ done, target, stillToDo: target === null ? null : Math.max(0, target - done), needPerDay: target === null ? null : 1.6, doingPerDay: 1.2, atThisSpeed, extra, verdict });

const overview = {
  manager: { id: 'm1', code: 'MGR-2', name: 'Priya Sharma' },
  teams: ['Team South', 'Team North'],
  month: { year: 2026, month: 11, key: '2026-11', dayOfMonth: 9, daysInMonth: 30, daysLeft: 21 },
  headline: { withTarget: 3, reached: 1, short: 2, biggestGap: { metric: 'placed', label: 'People placed in jobs', atThisSpeed: 37, target: 45, needPerDay: 1.6, doingPerDay: 1.2 } },
  bringMoney: [
    { metric: 'placed', label: 'People placed in jobs', hint: 'Joined the job', lowerIsBetter: false, ...f(11, 45, 37, -8, 'short') },
    { metric: 'paid', label: 'Paid the registration fee', hint: 'Job seekers who paid', lowerIsBetter: false, ...f(92, 320, 307, -13, 'short') },
    { metric: 'leftWithin30', label: 'Placed people who left within 30 days', hint: 'Each one can mean a free replacement or a refund', lowerIsBetter: true, ...f(1, null, 3, null, 'no_target') },
  ],
  leadToMoney: [{ metric: 'registered', label: 'Job seekers registered', hint: 'Profile made by an agent', lowerIsBetter: false, ...f(141, null, 470, null, 'no_target') }],
  rates: [{ key: 'registerToPay', label: 'Out of every 10 who register, how many pay', now: 6.5, unit: 'out_of_10' }],
  byTeam: [{ teamLeadId: 'tl1', team: 'Team South', teamLead: 'Ravi Shankar', people: 8, atWork: 8, rows: [{ metric: 'placed', label: 'People placed', ...f(7, 25, 23, -2, 'short') }] }],
  byWeek: [{ label: 'Week 1 · 1–7 Nov', soFar: false, registered: { done: 93, target: null }, paid: { done: 62, target: 75 }, businessesSignedUp: { done: 10, target: null }, placed: { done: 8, target: 10 } }],
  losses: [{ step: 'Registered → paid the registration fee', now: 65, why: '18 registration links stuck over 24 h' }],
  attendanceToday: { people: 16, atWork: 14, lateLogins: 3, onLeave: 1, missing: 1, lostSeconds: 22800 },
  watch: { agentsBehind: [{ staff: { id: 'fa2', code: 'FA-2', name: 'Meena R', role: 'field_agent', isIntern: true }, team: 'Team North', done: 2, target: 12 }], openFlags: 2 },
};

describe('Manager Command Center', () => {
  it('shows plan vs actual in counts (no rupees), teams, attendance and the watch list', async () => {
    const api = mockApi({ ...common, 'GET /manager/overview': overview });
    const { container } = render(<Home />, '/manager');
    expect(await screen.findByText("At today's speed we reach 1 of 3 targets")).toBeInTheDocument();
    expect(screen.getByText(/Biggest gap: people placed in jobs — we'd end at 37 of 45/)).toBeInTheDocument();
    expect(screen.getByText('Short by 8')).toBeInTheDocument();
    expect(screen.getByText('14 / 16')).toBeInTheDocument();
    expect(screen.getByText(/Meena R \(Field · North \(intern\)\)/)).toBeInTheDocument();
    expect(screen.getByText('Coming next')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/₹/);
    expect(api.calls('GET /manager/overview')[0].query.get('fromDate')).toBe('2026-10-31T18:30:00.000Z');
  });

  it('shows the error with a retry', async () => {
    mockApi({ ...common, 'GET /manager/overview': apiError(500, 'Internal server error', 'req-mg1') });
    render(<Home />, '/manager');
    expect((await screen.findAllByText('Reference: req-mg1')).length).toBeGreaterThan(0);
  });
});

describe('Plan vs actual', () => {
  it('shows each team and each week, and where people are lost', async () => {
    mockApi({ ...common, 'GET /manager/overview': overview });
    render(<Plan />, '/manager/plan');
    expect(await screen.findByText('Week 1 · 1–7 Nov')).toBeInTheDocument();
    expect(screen.getByText('62 (75)')).toBeInTheDocument();
    expect(screen.getByText('65 in 100')).toBeInTheDocument();
    expect(screen.getByText('Short by 2')).toBeInTheDocument();
  });
});

describe('Pipeline', () => {
  it('shows the funnel, reminds the agent of a close-to-refund job seeker and the agents of stuck work', async () => {
    const api = mockApi({
      ...common,
      'GET /manager/pipeline': {
        funnel: { registered: 141, paid: 92, interviewed: 44, offered: 12, placed: 11, daysToFill: 9 },
        closeToRefund: { windowDays: 15, total: 1, jobSeekers: 1, businesses: 0, rows: [{ kind: 'job_seeker', id: 'js1', code: 'JS-00176', name: 'Imran S', trade: 'Security guard', daysLeft: 5, bucket: '0-5', businessName: null, agent: { id: 'ca2', code: 'CA-2', name: 'Vikram S' }, team: 'Team North', standing: 'Offer sent today' }] },
        stuck: [{ kind: 'registrations', label: 'Registration links not finished > 24 h', count: 18, why: 'Most stop at payment', agents: 3 }],
        oldestVacancies: [{ id: 'v1', code: 'VC-00191', trade: 'Cook', business: { id: 'b1', name: 'Sri Sai Hotel' }, area: 'Jayanagar', openDays: 18, shown: 2, selected: 0, accountAgent: { id: 'fa1', name: 'Kiran Kumar' } }],
      },
      'POST /manager/pipeline/remind': { created: true, taskCode: 'FU-1' },
      'POST /manager/pipeline/stuck/registrations/remind': { reminded: 3 },
    });
    render(<Pipeline />, '/manager/pipeline');
    expect(await screen.findByText('9 days')).toBeInTheDocument();
    expect(screen.getByText('Offer sent today')).toBeInTheDocument();
    expect(screen.getByText('2 shown · 0 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remind the agent' }));
    await waitFor(() => expect(api.calls('POST /manager/pipeline/remind')[0].body).toEqual({ kind: 'job_seeker', id: 'js1' }));
    expect(await screen.findByText('Vikram S will call first')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remind the agents' }));
    expect(await screen.findByText('Reminded 3 agents')).toBeInTheDocument();
  });
});

const agentRow = { staff: { id: 'ca1', code: 'CA-11', name: 'Arun P', role: 'call_agent', isIntern: false }, team: 'Team North', teamLeadId: 'tl2', main: { metric: 'paid', done: 9, target: 45, percent: 20, atThisSpeed: 30 }, pace: 'behind', attendancePercent: 86, lateLogins: 5, lateMinutes: 74, leaveLeft: 1, openFlags: 0 };

describe('Agents and one agent', () => {
  it('lists agents with pace, attendance and late logins', async () => {
    mockApi({ ...common, 'GET /manager/agents': { month: { year: 2026, month: 11, dayOfMonth: 9, daysInMonth: 30 }, rows: [agentRow] } });
    render(<Agents />, '/manager/agents');
    expect(await screen.findByText('20% · 9 of 45')).toBeInTheDocument();
    expect(screen.getByText('5 · 74 min')).toBeInTheDocument();
    expect(screen.getAllByText('Behind').length).toBeGreaterThan(0);
  });

  it('shows one agent and gives a written warning with a reason', async () => {
    const api = mockApi({
      ...common,
      'GET /manager/agents/ca1': {
        staff: agentRow.staff,
        team: 'Team North',
        teamLeadId: 'tl2',
        teams: [{ id: 'tl1', team: 'Team South', name: 'Ravi Shankar' }, { id: 'tl2', team: 'Team North', name: 'Fatima Z' }],
        month: { year: 2026, month: 11, dayOfMonth: 9, daysInMonth: 30 },
        main: { metric: 'paid', done: 9, target: 45, atThisSpeed: 30, pace: 'behind' },
        lateLogins: 5,
        lateMinutes: 74,
        lostSeconds: 10140,
        leaveLeft: { casual: 1, emergency: 0 },
        registerToPay: 65,
        targets: [{ key: 'paid', label: 'Paid the registration fee', ...f(9, 45, 30, -15, 'short') }],
        attendance: [{ id: 'd1', date: '2026-11-05', loginAt: '2026-11-05T04:35:00Z', lateMinutes: 35, productionSeconds: 25500, dayType: 'full', countsAs: 'Late · 55m short', shortfallSeconds: 3300 }],
        quality: { averageTalkSeconds: 220, callsThisMonth: 212, stuckRegistrations: 4, followUpsOverdue: 6, flags: [] },
        notes: [{ id: 'n1', kind: 'note', text: 'Practise the fee explanation', createdAt: '2026-11-06T06:00:00Z', author: { id: 'tl2', name: 'Fatima Z', role: 'team_lead' } }],
      },
      'POST /manager/people/ca1/notes': { id: 'n2' },
      'POST /staff/ca1/reporting-line': { ok: true },
    });
    render(<Agent />, '/manager/agents/ca1', '/manager/agents/:id');
    expect(await screen.findByText('Arun P · call agent · Team North')).toBeInTheDocument();
    expect(screen.getByText('30 of 45')).toBeInTheDocument();
    expect(screen.getByText('Short by 15')).toBeInTheDocument();
    expect(screen.getByText('Thu 5')).toBeInTheDocument();
    expect(screen.getByText('Practise the fee explanation')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Give a written warning' }));
    let d = await dialog();
    await userEvent.type(within(d).getByLabelText(/What the warning is for/), 'Late five times');
    await userEvent.click(within(d).getByRole('button', { name: 'Give the warning' }));
    await waitFor(() => expect(api.calls('POST /manager/people/ca1/notes')[0].body).toEqual({ kind: 'written_warning', text: 'Late five times' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move to another team' }));
    d = await dialog();
    await userEvent.type(within(d).getByLabelText(/Reason/), 'Balance the teams');
    await userEvent.click(within(d).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(api.calls('POST /staff/ca1/reporting-line')[0].body).toEqual({ reportsToId: 'tl1', reason: 'Balance the teams' }));
  });
});

describe('Teams and a Team Lead', () => {
  it('shows team scorecards and the reporting tree', async () => {
    mockApi({
      ...common,
      'GET /manager/teams': {
        manager: { id: 'm1', name: 'Priya Sharma' },
        cards: [{ teamLeadId: 'tl1', team: 'Team South', teamLead: { id: 'tl1', name: 'Ravi Shankar', code: 'TL-3' }, callAgents: 3, fieldAgents: 2, placed: f(7, 25, 23, -2, 'short'), verdict: 'behind', attendancePercent: 97, lostThisWeekSeconds: 15000, requestsWaiting: 1, averageAnswerHours: 3, claimsDecided: 5, claimsOnTime: 5 }],
        reportingTree: [{ teamLeadId: 'tl1', team: 'Team South', teamLead: 'Ravi Shankar', agents: [{ id: 'ca1', name: 'Deepa Nair', role: 'call_agent', isIntern: false }] }],
        unassigned: [],
        table: [{ teamLeadId: 'tl1', team: 'Team South', registered: 88, paid: 58, businessesSignedUp: 10, interviewsDone: 27, placed: 7, lateLogins: 6, openFlags: 1 }],
      },
    });
    render(<Teams />, '/manager/teams');
    expect(await screen.findByText('7 of 25 placed · at this speed 23')).toBeInTheDocument();
    expect(screen.getByText('Deepa Nair (call)')).toBeInTheDocument();
    expect(screen.getByText('5 of 5')).toBeInTheDocument();
  });

  it("shows a Team Lead's members and own work", async () => {
    mockApi({
      ...common,
      'GET /manager/teams/tl2': {
        teamLead: { id: 'tl2', code: 'TL-4', name: 'Fatima Z' },
        team: 'Team North',
        placed: f(4, 20, 13, -7, 'short'),
        attendancePercent: 91,
        lostThisWeekSeconds: 41700,
        averageAnswerHours: 19,
        requestsWaiting: 2,
        claimsDecided: 4,
        claimsOnTime: 3,
        members: [{ staff: { id: 'fa2', code: 'FA-2', name: 'Meena R', role: 'field_agent', isIntern: true }, percent: 17, pace: 'behind', lateLogins: 1, lateMinutes: 5, leaveLeft: 2 }],
        ownWork: { workedDays: 8, expectedDays: 8, lateLogins: 0, loginCodesGiven: 41, visitsAssigned: 18, visitsOpen: 6, claimsLateHours: [52], leave: [] },
        notes: [],
      },
    });
    render(<TeamLead />, '/manager/teams/tl2', '/manager/teams/:id');
    expect(await screen.findByText('Team North · Fatima Z')).toBeInTheDocument();
    expect(screen.getByText('13 of 20')).toBeInTheDocument();
    expect(screen.getByText('Field (intern)')).toBeInTheDocument();
    expect(screen.getByText('1 decided late (52 h)')).toBeInTheDocument();
  });
});

const staffResponse = {
  manager: { id: 'm1', name: 'Priya Sharma' },
  rows: [
    { id: 'tl1', code: 'TL-3', name: 'Ravi Shankar', role: 'team_lead', isIntern: false, team: 'Team South', teamLeadId: 'tl1', reportsTo: { id: 'm1', name: 'Priya Sharma', role: 'manager', isYou: true }, state: 'active', locked: null, pendingDevice: null, approvedDevices: [], joinedOn: null },
    { id: 'ca9', code: 'CA-9', name: 'Arun P', role: 'call_agent', isIntern: false, team: 'Team North', teamLeadId: 'tl2', reportsTo: { id: 'tl2', name: 'Fatima Z', role: 'team_lead', isYou: false }, state: 'locked', locked: { byManager: false, until: '2026-11-09T13:00:00Z', reason: '5 wrong passwords' }, pendingDevice: null, approvedDevices: [], joinedOn: null },
  ],
  reportsToOptions: [
    { id: 'tl1', name: 'Ravi Shankar', role: 'team_lead', team: 'Team South' },
    { id: 'tl2', name: 'Fatima Z', role: 'team_lead', team: 'Team North' },
    { id: 'm1', name: 'Priya Sharma', role: 'manager', team: null },
  ],
  creatableRoles: ['team_lead', 'call_agent', 'field_agent'],
};

describe('Staff & access', () => {
  it('resets a password and shows the one-time link; unlocks with a reason', async () => {
    const api = mockApi({
      ...common,
      'GET /manager/staff': staffResponse,
      'POST /staff/tl1/reset-password': { resetUrl: 'https://app.laboura.in/app/p/invite/abc123', resetToken: 'abc123', expiresAt: '2026-11-12T12:30:00Z' },
      'POST /staff/ca9/unlock': { success: true },
    });
    render(<Staff />, '/manager/staff');
    expect((await screen.findAllByText('Locked · 5 wrong passwords')).length).toBeGreaterThan(0);
    const row = screen.getByText('Ravi Shankar').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Reset password' }));
    let d = await dialog();
    expect(within(d).getByText(/old password keeps working until they use the link/)).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: 'Make the link' }));
    await waitFor(() => expect(api.calls('POST /staff/tl1/reset-password')).toHaveLength(1));
    expect(await screen.findByText('https://app.laboura.in/app/p/invite/abc123')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    const locked = screen.getByText('Arun P').closest('tr') as HTMLElement;
    await userEvent.click(within(locked).getByRole('button', { name: 'Unlock' }));
    d = await dialog();
    await userEvent.type(within(d).getByLabelText(/Reason/), 'Checked with him');
    await userEvent.click(within(d).getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(api.calls('POST /staff/ca9/unlock')[0].body).toEqual({ reason: 'Checked with him' }));
  });

  it('adds an intern field agent under a Team Lead, with a start date', async () => {
    const api = mockApi({
      ...common,
      'GET /manager/staff': staffResponse,
      'POST /staff': { staff: { code: 'FA-0031', name: 'Meena R' }, inviteUrl: 'https://app.laboura.in/app/p/invite/tok', inviteExpiresAt: '2026-11-12T12:30:00Z' },
    });
    render(<Staff />, '/manager/staff');
    await screen.findAllByText('Ravi Shankar');
    await userEvent.type(screen.getByLabelText(/Full name/), 'Meena R');
    const roles = screen.getAllByLabelText(/^Role/);
    await userEvent.selectOptions(roles[roles.length - 1], 'field_agent:intern');
    await userEvent.selectOptions(screen.getByLabelText(/Reports to/), 'tl2');
    await userEvent.click(screen.getByRole('button', { name: 'Add · send staff code' }));
    await waitFor(() => expect(api.calls('POST /staff')[0].body).toEqual({ name: 'Meena R', role: 'field_agent', teamLeadId: 'tl2', intern: true, joinedOn: '2026-11-09' }));
    expect(await screen.findByText('https://app.laboura.in/app/p/invite/tok')).toBeInTheDocument();
  });
});

describe('Attendance and leave', () => {
  it('shows the day and changes a day with a reason', async () => {
    const api = mockApi({
      ...common,
      'GET /manager/attendance': {
        from: '2026-11-09',
        to: '2026-11-09',
        singleDay: true,
        rows: [{ staff: { id: 'ca1', code: 'CA-1', name: 'Rahul M', role: 'call_agent', isIntern: false }, team: 'Team South', dayId: 'day1', loginAt: '2026-11-09T04:11:00Z', logoutAt: null, dayType: 'open', countsAs: 'Working', change: null, productionSeconds: 23400, lateMinutes: 11, lateDays: 1, fullDays: 0, halfDays: 0, absentDays: 0, leaveDays: 0, lostSeconds: 0 }],
        summary: { people: 16, atWork: 14, lateLogins: 3, missing: 1, lostSeconds: 0, lostTodaySeconds: 22800, lostThisWeekSeconds: 56700 },
      },
      'POST /attendance/days/day1/day-type': { ok: true },
    });
    render(<Attendance />, '/manager/attendance');
    expect(await screen.findByText('14 / 16')).toBeInTheDocument();
    expect(screen.getByText('6h 20m')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change day…' }));
    const d = await dialog();
    await userEvent.selectOptions(within(d).getByLabelText(/Counts as/), 'half');
    await userEvent.type(within(d).getByLabelText(/Reason/), 'Left early, approved');
    await userEvent.click(within(d).getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(api.calls('POST /attendance/days/day1/day-type')[0].body).toEqual({ dayType: 'half', reason: 'Left early, approved' }));
  });

  it('shows who is off, heavy planned leave and balances', async () => {
    mockApi({
      ...common,
      'GET /manager/leave': {
        month: '2026-11',
        summary: { offToday: 1, offNext7: 4, withTeamLeads: 1, waitingForYou: 3, atOrOver3: 1 },
        off: [{ id: 'l1', staff: { id: 'tl1', name: 'Ravi Shankar', role: 'team_lead', isIntern: false }, team: 'Team South', kind: 'casual', from: '2026-11-12', to: '2026-11-13', days: 2, status: 'pending', where: 'With the Manager', withTeamLead: false, withManager: true, decidedBy: null, waitingHours: 5 }],
        heavy: [{ staff: { id: 'ca2', name: 'Vikram S', role: 'call_agent', isIntern: false }, team: 'Team North', taken: 2, takenDates: [], pending: 5, wouldBe: 7, requestId: 'l2' }],
        balances: [{ staff: { id: 'ca1', name: 'Deepa Nair', role: 'call_agent', isIntern: false }, team: 'Team South', plannedLeft: 2, emergencyLeft: 2, plannedUsedThisMonth: 0, emergencyUsedThisMonth: 0 }],
      },
    });
    render(<Leave />, '/manager/leave');
    expect(await screen.findByText('Waiting · you')).toBeInTheDocument();
    expect(screen.getByText('Asking for 5 more · would be 7 · you decide')).toBeInTheDocument();
    expect(screen.getByText('Deepa Nair')).toBeInTheDocument();
  });
});

describe('Work boards', () => {
  it('call center lists call agents with today\'s counts', async () => {
    mockApi({
      ...common,
      'GET /manager/call-center': {
        summary: { onCallsNow: 3, calls: 190, connectPercent: 49, registrations: 15, followUpsOverdue: 5, missedIncoming: 2, averageTalkSeconds: 200 },
        rows: [{ staff: { id: 'ca1', code: 'CA-1', name: 'Deepa Nair', role: 'call_agent', isIntern: false }, team: 'Team South', now: { status: 'available', since: null, overBreak: false, idleSeconds: 0 }, calls: 58, answered: 31, connectPercent: 53, talkSeconds: 7560, registered: 6, paid: 3, followUpsOverdue: 0 }],
        overdueFollowUps: [],
        missed: [],
      },
    });
    render(<CallCenter />, '/manager/call-center');
    expect(await screen.findByText('190')).toBeInTheDocument();
    expect(screen.getByText('2h 06m')).toBeInTheDocument();
  });

  it('field ops assigns a visit request', async () => {
    const api = mockApi({
      ...common,
      'GET /manager/field-ops': {
        summary: { visits: 15, onboarded: 3, requestsToAssign: 1, shortVisitsFlagged: 2, proofProblems: 0 },
        visitsByTeam: [{ teamLeadId: 'tl2', team: 'Team North', visitsThisWeek: 21 }],
        rows: [],
        requests: [{ id: 'a1', business: { id: 'b1', code: 'BZ-1', name: 'Annapoorna Mess', locality: 'Jayanagar' }, purpose: 'verification', createdAt: NOW.toISOString(), suggested: null }],
        agents: [{ id: 'fa1', name: 'Kiran Kumar', onLeave: false }],
      },
      'POST /businesses/b1/visit-assignments/a1/assign': { ok: true },
    });
    render(<FieldOps />, '/manager/field-ops');
    expect(await screen.findByText('Annapoorna Mess · Jayanagar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    const d = await dialog();
    await userEvent.click(within(d).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(api.calls('POST /businesses/b1/visit-assignments/a1/assign')[0].body).toEqual({ assignedStaffId: 'fa1' }));
  });

  it('flags: resolves a quality flag; money and bypass flags go to the CEO; Send to CEO waits', async () => {
    const api = mockApi({
      ...common,
      'GET /manager/flags': {
        summary: { open: 2, forCeo: 1, resolvedThisMonth: 7 },
        rows: [
          { id: 'f1', code: 'RF-1', kind: 'visit_short', title: 'Short visit', subjectType: 'staff', subjectId: 'x', details: null, raisedAt: NOW.toISOString(), staff: { id: 'fa3', code: 'FA-3', name: 'Arun S', role: 'field_agent' }, team: 'Team North', isIntern: false, goesToCeo: false },
          { id: 'f2', code: 'RF-2', kind: 'bypass_suspected', title: 'Suspected bypass', subjectType: 'business', subjectId: 'b', details: null, raisedAt: NOW.toISOString(), staff: { id: 'fa3', code: 'FA-3', name: 'Arun S', role: 'field_agent' }, team: 'Team North', isIntern: false, goesToCeo: true },
        ],
      },
      'POST /manager/flags/f1/resolve': { ok: true },
    });
    render(<Flags />, '/manager/flags');
    expect(await screen.findByText('Goes to CEO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to CEO' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText(/What you found/), 'Owner was out');
    await userEvent.click(within(d).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(api.calls('POST /manager/flags/f1/resolve')[0].body).toEqual({ resolution: 'Owner was out', status: 'resolved' }));
  });
});

describe('Targets, reports, login codes, notifications', () => {
  it('targets: saves an edited agent target and copies from last month', async () => {
    const api = mockApi({
      ...common,
      'GET /manager/targets': {
        year: 2026,
        month: 11,
        editable: true,
        previous: { year: 2026, month: 10, targets: 2 },
        whole: { candidatesActivated: 45, vacanciesCaptured: null, placementsClosed: null, repeatBusinesses: null },
        teams: [{ teamLeadId: 'tl1', team: 'Team South', candidatesActivated: 45, vacanciesCaptured: null, placementsClosed: null, repeatBusinesses: null }],
        agents: [{ staff: { id: 'ca1', code: 'CA-1', name: 'Deepa Nair', role: 'call_agent', isIntern: false }, team: 'Team South', teamLeadId: 'tl1', targetId: 't1', target: { candidatesActivated: 45, vacanciesCaptured: null, placementsClosed: null, repeatBusinesses: null }, main: { metric: 'paid', done: 27, target: 45, percent: 60 }, pace: 'on_pace' }],
        leaderboard: [{ position: 1, staff: { id: 'ca1', code: 'CA-1', name: 'Deepa Nair', role: 'call_agent', isIntern: false }, team: 'Team South', main: { metric: 'paid', done: 27, target: 45, percent: 60 } }],
      },
      'PUT /manager/targets': { created: 0, updated: 1, skipped: 0 },
      'POST /manager/targets/copy': { copied: 2, skipped: [] },
    });
    render(<Targets />, '/manager/targets');
    const input = await screen.findByLabelText('Paid registrations for Deepa Nair');
    await userEvent.clear(input);
    await userEvent.type(input, '50');
    expect(screen.getAllByText('50').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Save targets' }));
    await waitFor(() => expect(api.calls('PUT /manager/targets')[0].body).toEqual({ year: 2026, month: 11, rows: [{ staffId: 'ca1', candidatesActivated: 50 }] }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy from October' }));
    await waitFor(() => expect(api.calls('POST /manager/targets/copy')[0].body).toEqual({ fromYear: 2026, fromMonth: 10, toYear: 2026, toMonth: 11 }));
    expect(screen.getByText('27 paid')).toBeInTheDocument();
  });

  it('weekly reports: one row per week and each team\'s last week', async () => {
    mockApi({
      ...common,
      'GET /manager/reports/weekly': {
        rows: [{ from: '2026-11-02T18:30:00Z', to: '2026-11-09T18:29:59Z', startDay: '2026-11-03', registered: 93, paid: 62, businessesSignedUp: 10, interviewsDone: 36, placed: 8, attendancePercent: 96, lostSeconds: 34200, placementTarget: 10, reached: false }],
        lastWeek: { from: '', to: '' },
        teams: [{ teamLeadId: 'tl1', team: 'Team South', teamLead: 'Ravi', placed: 5, placementPlan: 6, paid: 38, attendancePercent: 97, lateLogins: 4, best: { staff: { id: 'fa1', name: 'Kiran Kumar' }, placed: 3, paid: 2 }, needsHelp: null }],
      },
    });
    render(<Reports />, '/manager/reports');
    expect(await screen.findByText('93')).toBeInTheDocument();
    expect(screen.getByText('Short')).toBeInTheDocument();
    expect(screen.getByText('5 (plan 6)')).toBeInTheDocument();
  });

  it('login codes: shows the code to read out for a waiting request', async () => {
    const api = mockApi({
      ...common,
      'GET /login-codes/pending': [{ id: 'r1', createdAt: NOW.toISOString(), expiresAt: '2026-11-09T12:35:00Z', onOfficeNetwork: true, staff: { id: 'tl1', name: 'Ravi Shankar', code: 'TL-3', role: 'team_lead' }, staffDevice: { id: 'd1', label: 'Office PC 1', platform: 'Windows' } }],
      'GET /manager/login-codes': { summary: { waiting: 1, codesToday: 6, locked: 0 }, codes: [{ id: 'c1', at: '2026-11-09T03:52:00Z', to: { id: 'tl1', name: 'Ravi Shankar', code: 'TL-3' }, givenBy: { id: 'm1', name: 'Priya Sharma', role: 'manager', isYou: true }, device: 'Office PC 1', used: true }] },
      'POST /login-codes/r1/reveal': { code: '503827' },
    });
    render(<LoginCodes />, '/manager/login-codes');
    expect((await screen.findAllByText('Priya (you)')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Show code' }));
    expect(await screen.findByText('5 0 3 8 2 7')).toBeInTheDocument();
    expect(api.calls('POST /login-codes/r1/reveal')).toHaveLength(1);
  });

  it('notifications: filters by type', async () => {
    mockApi({
      ...common,
      'GET /notifications': { openCount: 1, unseenCount: 0, total: 2, items: [
        { id: 'n1', kind: 'leave_request', title: 'Ravi Shankar asked for 2 days off', body: '12–13 Nov', link: '/manager/requests', subjectType: 'leave', subjectId: 'l1', status: 'open', seen: true, createdAt: NOW.toISOString(), seenAt: null, clearedAt: null, clearedReason: null, clearedBy: null },
        { id: 'n2', kind: 'review_flag', title: '2 shop visits under 3 minutes', body: null, link: '/manager/flags', subjectType: 'flag', subjectId: 'f1', status: 'open', seen: true, createdAt: NOW.toISOString(), seenAt: null, clearedAt: null, clearedReason: null, clearedBy: null },
      ] },
    });
    render(<Notifications />, '/manager/notifications');
    expect(await screen.findByText('Ravi Shankar asked for 2 days off')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Quality');
    expect(screen.queryByText('Ravi Shankar asked for 2 days off')).not.toBeInTheDocument();
    expect(screen.getByText('2 shop visits under 3 minutes')).toBeInTheDocument();
  });

  it('the requests screens say "Coming next"', async () => {
    mockApi(common);
    for (const [ui, path] of [[<Requests key="a" />, '/manager/requests'], [<Decided key="b" />, '/manager/requests/decided'], [<RequestDetail key="c" />, '/manager/requests/x']] as const) {
      const { unmount } = render(ui, path);
      expect(await screen.findByText('Coming next')).toBeInTheDocument();
      unmount();
    }
  });
});
