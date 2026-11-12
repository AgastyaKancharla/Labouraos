import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import Team from '../C-Team';
import Teams from '../C-Teams';
import Salaries from '../C-Team-Salaries';
import Devices from '../C-Team-Devices';
import LoginCodes from '../C-LoginCodes';
import AttendanceLive from '../C-Att-Live';
import TeamAttendance from '../C-Team-Attendance';
import AttendancePerson from '../C-Att-Person';
import TeamLeave from '../C-Team-Leave';
import Targets from '../C-Team-Targets';
import Leaderboard from '../C-Leaderboard';
import CallCenter from '../C-CallCenter';
import FieldOps from '../C-FieldOps';
import Checkins from '../C-Checkins';
import AuditLog from '../C-Audit';
import Flags from '../C-Audit-Flags';
import Privacy from '../C-Privacy';
import SystemScreen from '../C-System';
import Notifications from '../C-Notifications';
import Pricing from '../C-Pricing';
import Trades from '../C-Pricing-Trades';
import Areas from '../C-Pricing-Areas';
import MinimumWage from '../C-Pricing-MinWage';
import KeepingData from '../C-Pricing-Data';
import Partner from '../C-Partner';

const NOW = new Date('2026-11-11T06:30:00Z'); // 12:00 IST
const common = { 'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [], 'GET /payroll/corrections': { status: 'waiting', rows: [] }, 'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: NOW.toISOString() } };
const render = (ui: React.ReactElement, path: string, route?: string) => {
  signInAs('ceo');
  return renderScreen(ui, { portal: 'ceo', path, route, now: NOW });
};
const dialog = () => screen.findByRole('dialog');

const teamResponse = {
  rows: [
    { id: 'tl1', code: 'TL-0003', name: 'Ravi Shankar', email: null, role: 'team_lead', team: 'Team South', reportsTo: { id: 'm1', name: 'Priya Sharma', role: 'manager' }, state: 'active', authenticator: false, signedIn: true, lockedUntil: null, lockedReason: null },
    { id: 'ca1', code: 'CA-0011', name: 'Deepa Nair', email: null, role: 'call_agent', team: 'Team South', reportsTo: { id: 'tl1', name: 'Ravi Shankar', role: 'team_lead' }, state: 'active', authenticator: false, signedIn: false, lockedUntil: null, lockedReason: null },
    { id: 'fa1', code: 'FA-0019', name: 'Meena R', email: null, role: 'field_agent', team: 'Team North', reportsTo: { id: 'tl2', name: 'Fatima Z', role: 'team_lead' }, state: 'invite_pending', authenticator: false, signedIn: false, lockedUntil: null, lockedReason: null },
  ],
  totals: { accounts: 12, signedInNow: 7, invitesPending: 1, locked: 0, withoutAuthenticator: 0 },
  organisation: { ceos: [{ id: 'c', name: 'Agastya Kancharla' }], managers: [{ id: 'm1', name: 'Priya Sharma', teams: ['Team South', 'Team North'] }], teamLeads: [{ id: 'tl1', name: 'Ravi Shankar', team: 'Team South', manager: 'Priya Sharma', callAgents: 3, fieldAgents: 2 }], finance: [{ id: 'f', name: 'Nisha Rao' }] },
  reportsToOptions: [
    { id: 'tl1', name: 'Ravi Shankar', role: 'team_lead', team: 'Team South' },
    { id: 'tl2', name: 'Fatima Z', role: 'team_lead', team: 'Team North' },
    { id: 'm1', name: 'Priya Sharma', role: 'manager', team: null },
  ],
};

describe('Team & access', () => {
  it('shows the organisation and accounts, locks with a reason and adds a staff member under a Team Lead', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/team': teamResponse,
      'POST /staff/ca1/lock': { ok: true },
      'POST /staff': { staff: { code: 'CA-0020', name: 'Rahul M' }, inviteToken: 'tok-123' },
    });
    render(<Team />, '/ceo/team');
    expect(await screen.findByText(/3 call \+ 2 field agents/)).toBeInTheDocument();
    expect(screen.getByText(/12 staff accounts · 7 signed in now/)).toBeInTheDocument();
    const row = screen.getByText('Deepa Nair').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Lock' }));
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText(/Reason/), 'Left the company');
    await userEvent.click(within(d).getByRole('button', { name: 'Lock Deepa Nair' }));
    await waitFor(() => expect(api.calls('POST /staff/ca1/lock')[0].body).toEqual({ reason: 'Left the company' }));

    await userEvent.type(screen.getByLabelText(/Full name/), 'Rahul M');
    await userEvent.click(screen.getByRole('button', { name: 'Add · send staff code' }));
    await waitFor(() => expect(api.calls('POST /staff')[0].body).toEqual({ name: 'Rahul M', email: '', role: 'call_agent', reportsToId: 'tl1' }));
    expect(await screen.findByText('tok-123')).toBeInTheDocument();
  });

  it('shows a co-founder title on a CEO-level account and lets the CEO change it', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/team': {
        ...teamResponse,
        rows: [{ id: 'c2', code: 'CEO-0002', name: 'Sanket', email: 'sanket@laboura.in', role: 'ceo', title: 'co_founder', team: null, reportsTo: null, state: 'active', authenticator: true, signedIn: false, lockedUntil: null, lockedReason: null }, ...teamResponse.rows],
      },
      'POST /ceo/team/c2/title': { id: 'c2', title: 'founder' },
    });
    render(<Team />, '/ceo/team');
    const row = (await screen.findByText('Sanket')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Co-founder')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Title' }));
    const d = await dialog();
    await userEvent.selectOptions(within(d).getByLabelText(/Title/), 'founder');
    await userEvent.click(within(d).getByRole('button', { name: 'Save title' }));
    await waitFor(() => expect(api.calls('POST /ceo/team/c2/title')[0].body).toEqual({ title: 'founder' }));
    // Only CEO-level accounts get a title.
    const agent = screen.getByText('Deepa Nair').closest('tr') as HTMLElement;
    expect(within(agent).queryByRole('button', { name: 'Title' })).toBeNull();
  });

  it('takes a joining date when adding staff and lets the CEO set one later', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/team': teamResponse,
      'POST /staff': { staff: { code: 'CA-0021', name: 'Kavya R' }, inviteToken: 'tok-9' },
      'PUT /staff/ca1/joined-on': { id: 'ca1' },
    });
    render(<Team />, '/ceo/team');
    await screen.findByText(/3 call \+ 2 field agents/);
    const row = screen.getByText('Deepa Nair').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Joining date' }));
    const d = await dialog();
    fireEvent.change(within(d).getByLabelText(/Joined on/), { target: { value: '2026-10-28' } });
    await userEvent.click(within(d).getByRole('button', { name: 'Joining date · Deepa Nair' }));
    await waitFor(() => expect(api.calls('PUT /staff/ca1/joined-on')[0]?.body).toEqual({ joinedOn: '2026-10-28' }));
    await userEvent.type(screen.getByLabelText(/Full name/), 'Kavya R');
    fireEvent.change(screen.getByLabelText(/Joining date/), { target: { value: '2026-11-16' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add · send staff code' }));
    await waitFor(() => expect(api.calls('POST /staff')[0].body).toEqual(expect.objectContaining({ name: 'Kavya R', joinedOn: '2026-11-16' })));
  });

  it('shows the error with a retry', async () => {
    mockApi({ ...common, 'GET /ceo/team': apiError(500, 'Internal server error', 'req-t1') });
    render(<Team />, '/ceo/team');
    expect((await screen.findAllByText('Reference: req-t1')).length).toBeGreaterThan(0);
  });
});

describe('Teams', () => {
  it('lists teams with pace and renames a team and changes its Manager', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/teams': {
        rows: [{ id: 'tl1', code: 'TL-3', teamName: null, team: 'Team Ravi', teamLead: { id: 'tl1', name: 'Ravi Shankar' }, manager: { id: 'm1', name: 'Priya Sharma' }, callAgents: 3, fieldAgents: 2, agents: [], placementsThisMonth: 14, activationsThisMonth: 20, agentsBehind: 2 }],
        agentsWithoutTeam: [],
        managers: [{ id: 'm1', name: 'Priya Sharma' }, { id: 'm2', name: 'Arjun K' }],
        allAgents: [],
      },
      'POST /ceo/teams/tl1': { ok: true },
      'POST /staff/tl1/reporting-line': { ok: true },
    });
    render(<Teams />, '/ceo/team/teams');
    expect(await screen.findByText('2 agents behind')).toBeInTheDocument();
    expect(screen.getByText('14 placements · 20 activated')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText(/Team name/), 'Team South');
    await userEvent.selectOptions(within(d).getByLabelText(/Manager who looks after/), 'm2');
    await userEvent.click(within(d).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /staff/tl1/reporting-line')[0]?.body).toEqual({ reportsToId: 'm2', moveOpenWork: true }));
    expect(api.calls('POST /ceo/teams/tl1')[0].body).toEqual({ name: 'Team South' });
  });
});

describe('Salaries', () => {
  // Paid days now come from payroll: weekly offs and holidays are paid days
  // (Phase 22 Part B), so the sheet reads GET /finance/salaries instead of the
  // attendance month sheet, and the rupee columns are filled.
  it("shows last month's payroll from attendance with the rupees", async () => {
    const api = mockApi({
      ...common,
      'GET /finance/staff-salaries': { month: '2026-11', rows: [] },
      'GET /finance/salaries': {
        month: '2026-10', label: 'October 2026', status: 'paid', closed: false, salaryDays: 31, calendarDays: 31, prepareFrom: '2026-10-31', canPrepare: false, payDay: '2026-11-01',
        run: { preparedBy: 'Nisha', preparedAt: '2026-10-31T10:00:00Z', approvedBy: 'Agastya', approvedAt: '2026-10-31T12:00:00Z', returnedBy: null, returnedAt: null, returnedReason: null, paidAt: '2026-11-01T05:00:00Z' },
        totals: { people: 1, grossPaise: 2000000, deductionsPaise: 137000, lossOfPayAndShortfallPaise: 137000, correctionsPaise: 0, netPaise: 1863000, paidCount: 1, paidPaise: 1863000, unpaidCount: 0 },
        missingSalary: [], openDays: [], statutory: { lines: [], note: 'Added after company registration' },
        rows: [{ staffId: 's1', staffCode: 'CA-1', name: 'Kiran Kumar', role: 'field_agent', joinedOn: '2026-08-01', monthlyPaise: 2000000, salaryDays: 26, calendarDays: 31, workingDays: 27, holidays: 0, fullDays: 25, halfDays: 0, paidLeaveDays: 2, unpaidLeaveDays: 0, absentDays: 2, notEmployedDays: 0, unmarkedDays: 0, paidDays: 24, lossOfPayDays: 2, shortfallMinutes: 70, basicPaise: 1000000, hraPaise: 400000, specialPaise: 600000, grossPaise: 2000000, notEmployedPaise: 0, lossOfPayPaise: 129032, shortfallPaise: 7968, pfPaise: 0, esiPaise: 0, professionalTaxPaise: 0, deductionsPaise: 137000, correctionPaise: 0, correctionNote: null, netPaise: 1863000, line: { id: 'l1', status: 'paid', paidAt: '2026-11-01T05:00:00Z', utrLast4: '1111', paidFrom: 'bank_transfer' } }],
      },
    });
    render(<Salaries />, '/ceo/team/salaries');
    expect(await screen.findByText('24 / 26')).toBeInTheDocument();
    expect(screen.getByText('1h 10m')).toBeInTheDocument();
    expect(screen.getAllByText('₹18,630').length).toBeGreaterThan(0);
    expect(api.calls('GET /finance/salaries')[0].query.get('month')).toBe('2026-10');
  });
});

describe('Devices & logins', () => {
  it('lists devices and codes given today, removes a device and adds an office network', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/devices': {
        rows: [{ id: 'd1', staff: { id: 'ca1', code: 'CA-1', name: 'Deepa Nair', role: 'call_agent' }, label: 'Office PC 3', platform: 'Windows', status: 'approved', network: 'office', lastLoginAt: '2026-11-11T04:01:00Z', oddHour: false, approvedBy: 'Ravi' }],
        summary: { approved: 1, pending: 0, revoked: 0, oddHour: 0 },
        codesToday: [{ id: 'l1', at: '2026-11-11T04:00:00Z', givenBy: { id: 'tl1', name: 'Ravi Shankar', role: 'team_lead' }, to: { id: 'ca1', name: 'Deepa Nair', code: 'CA-1' }, device: 'Office PC 3' }],
      },
      'GET /office-networks': [],
      'POST /staff/devices/d1/revoke': { ok: true },
      'POST /office-networks': { id: 'n1' },
    });
    render(<Devices />, '/ceo/team/devices');
    expect(await screen.findByText('Today 09:31')).toBeInTheDocument();
    expect(screen.getByText('Ravi Shankar → Deepa Nair')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Remove Office PC 3' }));
    await waitFor(() => expect(api.calls('POST /staff/devices/d1/revoke')).toHaveLength(1));
    await userEvent.type(screen.getByLabelText(/^Name/), 'JP Nagar office');
    await userEvent.type(screen.getByLabelText(/Network address/), '103.21.58.0/24');
    await userEvent.click(screen.getByRole('button', { name: '+ Add network' }));
    await waitFor(() => expect(api.calls('POST /office-networks')[0].body).toEqual({ label: 'JP Nagar office', cidr: '103.21.58.0/24' }));
  });
});

describe('Login codes', () => {
  it('shows a waiting request, reveals the code to read out, and unlocks a locked account', async () => {
    const api = mockApi({
      ...common,
      'GET /login-codes/pending': [{ id: 'r1', createdAt: '2026-11-11T03:34:00Z', expiresAt: '2026-11-11T03:44:00Z', onOfficeNetwork: true, status: 'pending', staff: { id: 'tl1', name: 'Ravi Shankar', code: 'TL-0003', role: 'team_lead' }, staffDevice: { id: 'd', label: 'Office PC 1', platform: 'Windows' } }],
      'GET /ceo/access': { summary: { waiting: 1, codesToday: 19, locked: 1, invitesPending: 0 }, locked: [{ id: 'ca9', code: 'CA-9', name: 'Arun P', role: 'call_agent', lockedUntil: '2026-11-11T07:00:00Z', reason: '5 wrong passwords', byManager: false }], invites: [], codes: [] },
      'POST /login-codes/r1/reveal': { code: '481207' },
      'POST /staff/ca9/unlock': { ok: true },
    });
    render(<LoginCodes />, '/ceo/login-codes');
    expect(await screen.findByText('Ravi Shankar')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show code to read out' }));
    expect(await screen.findByText('481 207')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Unlock Arun P' }));
    await waitFor(() => expect(api.calls('POST /staff/ca9/unlock')).toHaveLength(1));
  });
});

describe('Password resets (POST /staff/:id/reset-password, never the old re-issued invite)', () => {
  const reset = { staff: { code: 'CA-9' }, resetUrl: 'https://app.laboura.in/app/p/invite/abc123', resetToken: 'abc123', expiresAt: '2026-11-14T06:30:00Z' };

  it('Login codes: Reset on a locked account sends a one-time link and keeps the old password until it is used', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/access': { summary: { waiting: 0, codesToday: 0, locked: 1, invitesPending: 1 }, locked: [{ id: 'ca9', code: 'CA-9', name: 'Arun P', role: 'call_agent', lockedUntil: '2026-11-11T07:00:00Z', reason: '5 wrong passwords', byManager: false }], invites: [{ id: 'fa1', code: 'FA-0019', name: 'Meena R', role: 'field_agent', invitedAt: '2026-11-10T05:00:00Z', expired: false }], codes: [] },
      'POST /staff/ca9/reset-password': reset,
      'POST /staff/fa1/reissue-invite': { staff: { code: 'FA-0019' }, inviteToken: 'inv-1' },
    });
    render(<LoginCodes />, '/ceo/login-codes');
    const row = (await screen.findByText('Arun P')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Reset' }));
    const d = await dialog();
    expect(within(d).getByText(/old password and authenticator keep working until they use the link/)).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: 'Make the link' }));
    await waitFor(() => expect(api.calls('POST /staff/ca9/reset-password')).toHaveLength(1));
    expect(await screen.findByText('https://app.laboura.in/app/p/invite/abc123')).toBeInTheDocument();
    expect(api.calls('POST /staff/ca9/reissue-invite')).toHaveLength(0);

    // Someone who never set a password gets a new invite instead (a reset needs a password to replace).
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    const invite = screen.getByText('Meena R').closest('tr') as HTMLElement;
    expect(within(invite).queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    await userEvent.click(within(invite).getByRole('button', { name: 'New invite' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'New invite for Meena R' }));
    await waitFor(() => expect(api.calls('POST /staff/fa1/reissue-invite')).toHaveLength(1));
  });

  it('Team & access: Reset password on an active account uses the reset link; pending invites keep Resend', async () => {
    const api = mockApi({ ...common, 'GET /ceo/team': teamResponse, 'POST /staff/ca1/reset-password': { ...reset, staff: { code: 'CA-0011' } } });
    render(<Team />, '/ceo/team');
    const row = (await screen.findByText('Deepa Nair')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Reset password' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Make the link' }));
    await waitFor(() => expect(api.calls('POST /staff/ca1/reset-password')).toHaveLength(1));
    expect(await screen.findByText('https://app.laboura.in/app/p/invite/abc123')).toBeInTheDocument();
    const pending = screen.getByText('Meena R').closest('tr') as HTMLElement;
    expect(within(pending).queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
    expect(within(pending).getByRole('button', { name: 'Resend' })).toBeInTheDocument();
  });
});

const liveRow = (id: string, name: string, status: string, extra = {}) => ({ staff: { id, code: id, name, role: 'call_agent' }, status, since: '2026-11-11T06:26:00Z', loginAt: '2026-11-11T04:00:00Z', lateMinutes: 0, productionSeconds: 7200, breakSeconds: 600, breakOverSeconds: 0, overBreak: false, idle: false, idleSeconds: 0, ...extra });

describe('Attendance', () => {
  it('live board counts who is available, on calls, over break and missing', async () => {
    mockApi({ ...common, 'GET /attendance/live': { asOf: NOW.toISOString(), counts: {}, people: [liveRow('a', 'Deepa Nair', 'available'), liveRow('b', 'Rahul M', 'on_call'), liveRow('c', 'Sneha K', 'short_break', { overBreak: true }), liveRow('d', 'Vikram S', 'not_logged_in', { since: null })] } });
    render(<AttendanceLive />, '/ceo/attendance/live');
    expect(await screen.findByText('On call · 04:00')).toBeInTheDocument();
    expect(screen.getByText('Short break · over break time')).toBeInTheDocument();
    expect(screen.getAllByText('Not logged in').length).toBeGreaterThan(0);
  });

  it('today shows each person\'s day and what it counts as, for the period picked', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/attendance': {
        from: '2026-11-11', to: '2026-11-11', singleDay: true,
        policy: { shiftStart: '09:30', shiftEnd: '18:30', productionHoursFullDay: 8, halfDayBelowHours: 4.5, dayToleranceMinutes: 10, lateGraceMinutes: 10 },
        rows: [{ staff: { id: 'a', code: 'CA-2', name: 'Arun P', role: 'call_agent', team: 'Team North' }, loginAt: '2026-11-11T04:22:00Z', logoutAt: null, dayType: 'full', countsAs: 'Late · 40m short', productionSeconds: 26400, breakSeconds: 1800, lateMinutes: 22, lateDays: 1, fullDays: 1, halfDays: 0, absentDays: 0, leaveDays: 0, shortfallSeconds: 2400 }],
        summary: { people: 21, loggedInToday: 18, lateLogins: 2, absent: 1, makeUpOwedSeconds: 24000, productionPercent: 91 },
      },
    });
    render(<TeamAttendance />, '/ceo/attendance');
    expect((await screen.findAllByText('Late · 40m short')).length).toBeGreaterThan(0);
    expect(screen.getByText('18 / 21')).toBeInTheDocument();
    expect(screen.getByText('6h 40m')).toBeInTheDocument();
    expect(api.calls('GET /ceo/attendance')[0].query.get('fromDate')).toBe('2026-11-10T18:30:00.000Z');
  });

  it('one person\'s report shows days and changes a day with a reason', async () => {
    const api = mockApi({
      ...common,
      'GET /attendance/report': { staff: { id: 'a', code: 'CA-2', name: 'Arun P', role: 'call_agent' }, from: '2026-11-01', to: '2026-11-11', lateLogins: { count: 1, days: [{ date: '2026-11-06', minutes: 22 }] }, days: [{ id: 'day6', date: '2026-11-06', dayType: 'half', loginAt: '2026-11-06T04:22:00Z', logoutAt: '2026-11-06T13:00:00Z', lateMinutes: 22, productionSeconds: 15000, breakOverSeconds: 300, idleSeconds: 0, shortfallSeconds: 0, makeUpSeconds: 0, hoursLostSeconds: 2400, leaveKind: null, change: null }], totals: { productionSeconds: 15000, hoursLostSeconds: 2400, lateLogins: 1, absentDays: 0, shortfallSeconds: 0, makeUpSeconds: 0 } },
      'GET /attendance/leave/balance': { staffId: 'a', casual: { left: 2 }, emergency: { left: 2 } },
      'GET /ceo/team': teamResponse,
      'POST /attendance/days/day6/day-type': { ok: true },
    });
    render(<AttendancePerson />, '/ceo/attendance/a', '/ceo/attendance/:staffId');
    expect(await screen.findByText('1 days · 22 min')).toBeInTheDocument();
    expect(screen.getByText('4 days')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change day' }));
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText(/Reason/), 'System down');
    await userEvent.click(within(d).getByRole('button', { name: /Change Fri 6/ }));
    await waitFor(() => expect(api.calls('POST /attendance/days/day6/day-type')[0].body).toEqual({ dayType: 'full', reason: 'System down' }));
  });

  it('leave & corrections approves a waiting request', async () => {
    const api = mockApi({
      ...common,
      'GET /attendance/requests/team': [{ kind: 'leave', id: 'lv1', staff: { id: 'ca1', code: 'CA-1', name: 'Deepa Nair', role: 'call_agent' }, status: 'pending', reason: 'Family function', where: 'with Ravi (TL)', createdAt: '2026-11-10T05:00:00Z', decided: null, canDecide: true, leaveKind: 'emergency', fromDate: '2026-11-13', toDate: '2026-11-13', days: 1, unpaidDays: 0, overturned: null }],
      'GET /attendance/leave/balance': { staffId: 'ca1', casual: { left: 1 }, emergency: { left: 2 } },
      'POST /attendance/requests/leave/lv1/approve': { ok: true },
    });
    render(<TeamLeave />, '/ceo/team/leave');
    expect(await screen.findByText('Emergency · 13 Nov 2026')).toBeInTheDocument();
    expect(await screen.findByText('3 days')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: /Approve Deepa Nair/ }));
    await waitFor(() => expect(api.calls('POST /attendance/requests/leave/lv1/approve')[0].body).toEqual({}));
  });
});

const targetRow = (id: string, name: string, role: string, main: number, target: number, pace: string, pos = 1) => ({ position: pos, staff: { id, code: id, name, role }, team: 'Team South', targetId: null, target: null, main: { achieved: main, target }, second: { achieved: 3, target: 12 }, feesPaise: role === 'field_agent' ? 8200000 : null, progressPercent: Math.round((main * 100) / target), pace });
const board = { year: 2026, month: 11, dayOfMonth: 11, daysInMonth: 30, rows: [targetRow('ca1', 'Deepa Nair', 'call_agent', 18, 30, 'on_pace'), targetRow('fa1', 'Kiran Kumar', 'field_agent', 9, 12, 'behind', 2)], summary: { agents: 2, withTarget: 2, behind: 1 } };

const plan = (o: Record<string, number | null>) => ({ registered: null, paid: null, businessesSignedUp: null, vacancies: null, interviewsDone: null, placed: null, repeatBusinesses: null, leftWithin30: null, ...o });
const companyPlan = {
  year: 2026,
  month: 11,
  plan: plan({ registered: 400, paid: 320, placed: 45 }),
  setAt: NOW.toISOString(),
  teams: [
    { teamLeadId: 'tl1', team: 'Team South', teamLead: 'Ravi Shankar', manager: { id: 'm1', name: 'Priya Sharma' }, split: plan({ paid: 180, placed: 25 }) },
    { teamLeadId: 'tl2', team: 'Team North', teamLead: 'Fatima Z', manager: { id: 'm1', name: 'Priya Sharma' }, split: plan({ paid: 140, placed: 15 }) },
  ],
  total: plan({ paid: 320, placed: 40 }),
  difference: plan({ registered: -400, paid: 0, placed: -5 }),
};

describe('Targets and leaderboard', () => {
  it("the company plan: shows the teams' split, whether it adds up, and saves the CEO's numbers", async () => {
    const api = mockApi({ ...common, 'GET /ceo/targets': { ...board, leaderboard: board.rows }, 'GET /plans/company': companyPlan, 'PUT /plans/company': companyPlan });
    render(<Targets />, '/ceo/targets');
    expect(await screen.findByText('Company plan · November')).toBeInTheDocument();
    expect(await screen.findByText('Team South')).toBeInTheDocument();
    expect(screen.getAllByText('Split by Priya Sharma')).toHaveLength(2);
    expect(screen.getByText('Adds up')).toBeInTheDocument();
    expect(screen.getByText('5 not split')).toBeInTheDocument();
    expect(screen.getByLabelText('Plan: Paid ₹499')).toHaveValue('320');
    const placed = screen.getByLabelText('Plan: Placements');
    await userEvent.clear(placed);
    await userEvent.type(placed, '40');
    await userEvent.type(screen.getByLabelText('Plan: Vacancies'), '90');
    await userEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(api.calls('PUT /plans/company')[0].body).toEqual({ year: 2026, month: 11, placed: 40, vacancies: 90 }));
  });

  it('shows progress and pace, sets a target and copies last month', async () => {
    const api = mockApi({ ...common, 'GET /ceo/targets': { ...board, leaderboard: board.rows }, 'GET /plans/company': companyPlan, 'POST /targets': { id: 't' }, 'POST /ceo/targets/copy': { copied: 2 } });
    render(<Targets />, '/ceo/targets');
    expect(await screen.findByText('18 / 30 activated')).toBeInTheDocument();
    expect(screen.getAllByText('Behind pace').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Copy from November' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: /Copy November's targets/ }));
    await waitFor(() => expect(api.calls('POST /ceo/targets/copy')[0].body).toEqual({ fromYear: 2026, fromMonth: 11, toYear: 2026, toMonth: 12 }));
    await userEvent.click(screen.getByRole('button', { name: 'Set November targets' }));
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText('Deepa Nair Activated'), '30');
    await userEvent.click(within(d).getByRole('button', { name: 'Save targets' }));
    await waitFor(() => expect(api.calls('POST /targets')[0].body).toEqual({ staffId: 'ca1', year: 2026, month: 11, candidatesActivated: 30 }));
  });

  it('ranks on activations and placements with fees', async () => {
    mockApi({ ...common, 'GET /ceo/targets': { ...board, leaderboard: board.rows } });
    render(<Leaderboard />, '/ceo/leaderboard');
    expect(await screen.findByText('9 placements')).toBeInTheDocument();
    expect(screen.getByText('₹82,000 fees')).toBeInTheDocument();
    expect(screen.getByText('75% · behind')).toBeInTheDocument();
  });

  it('Today / This week count the same results inside the range, from GET /ceo/leaderboard', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/targets': { ...board, leaderboard: board.rows },
      'GET /ceo/leaderboard': { leaderboard: [{ ...board.rows[1], position: 1, main: { achieved: 2, target: null }, feesPaise: 1600000, progressPercent: null, pace: 'no_target', target: null }] },
    });
    render(<Leaderboard />, '/ceo/leaderboard');
    expect(await screen.findByText('9 placements')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText('2 placements')).toBeInTheDocument();
    expect(screen.getByText('Targets are monthly')).toBeInTheDocument();
    const q = api.calls('GET /ceo/leaderboard')[0].query;
    expect(q.get('fromDate')).toBeTruthy();
  });
});

describe('Call center and field ops', () => {
  it('shows agents, assigns a missed call and resends a stuck registration link', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/call-center': {
        summary: { calls: 63, connectPercent: 38, missedToReturn: 1, linesInUse: 18, lineCapacity: 60, averageTalkSeconds: 250, agentsIdleNow: 1 },
        rows: [{ staff: { id: 'ca1', code: 'CA-1', name: 'Deepa Nair', team: 'Team South' }, now: { status: 'available', since: '2026-11-11T05:50:00Z', overBreak: false, idleSeconds: 0 }, calls: 22, answered: 9, connectPercent: 41, talkSeconds: 6480, registered: 2, interviews: 1, productionSeconds: 12840 }],
        missed: [{ id: 'cb1', at: '2026-11-11T06:12:00Z', phone: '+919845014412', callerName: null, jobSeeker: { id: 'js', code: 'JS-00203', name: 'Ramesh Gowda' }, status: 'pending', assignedTo: null }],
        recordings: [],
        followUps: [{ key: 'day7', label: 'Day 7 after "not selected"', due: 6, done: 5, overdue: 1 }],
        stuck: [{ id: 'js185', code: 'JS-00185', name: 'Pooja Nair', step: 'payment', reason: null, since: '2026-11-09T06:00:00Z', days: 2 }],
        agents: [{ id: 'ca1', name: 'Deepa Nair' }],
      },
      'POST /telephony/callbacks/cb1/assign': { ok: true },
      'POST /consent/links': { ok: true },
    });
    render(<CallCenter />, '/ceo/call-center');
    expect(await screen.findByText('Ramesh Gowda · JS-00203')).toBeInTheDocument();
    expect(screen.getByText('******4412')).toBeInTheDocument();
    expect(screen.getByText('18 / 60')).toBeInTheDocument();
    expect(screen.getByText('4m 10s')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Give this missed call to an agent' }));
    await waitFor(() => expect(api.calls('POST /telephony/callbacks/cb1/assign')[0].body).toEqual({ staffId: 'ca1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: /Resend Pooja Nair/ }));
    await waitFor(() => expect(api.calls('POST /consent/links')[0].body).toEqual({ jobSeekerId: 'js185' }));
  });

  it('field ops assigns a visit request to an agent', async () => {
    const biz = { id: 'b1', code: 'BZ-1', name: 'Lakshmi Tiffins', locality: 'Jayanagar' };
    const api = mockApi({
      ...common,
      'GET /ceo/field-ops': {
        summary: { visits: 14, onboarded: 3, vacanciesThisWeek: 9, visitToOnboardPercent: 21, geofenceMismatches: 1, openFlags: 2 },
        agentsNow: [{ staff: { id: 'fa1', name: 'Kiran Kumar' }, status: 'on_visit', area: 'BTM Layout', lastCheckInAt: null }],
        proof: [],
        rows: [{ staff: { id: 'fa1', name: 'Kiran Kumar', team: null }, now: { status: 'on_visit', since: null }, lastVisit: { business: 'Annapoorna Mess', area: 'BTM', at: NOW.toISOString() }, visits: 6, onboarded: 2, vacancies: 3, shown: 4, interviews: 1, geofenceMismatches: 0, openFlags: [], avgVisitSeconds: 720 }],
        requests: [{ id: 'va1', business: biz, purpose: 'verification', createdAt: '2026-11-09T05:00:00Z', suggested: { id: 'fa1', name: 'Kiran Kumar' }, nearest: { id: 'fa1', name: 'Kiran Kumar', distanceKm: 1.2 } }],
        revisitsDue: [{ id: 'v9', on: '2026-11-13', business: null, shopName: 'Sri Ganesh Stores', outcome: 'owner_not_there', agent: { id: 'fa1', name: 'Kiran Kumar' } }],
        revisits: [],
        agents: [{ id: 'fa1', name: 'Kiran Kumar' }],
      },
      'POST /businesses/b1/visit-assignments/va1/assign': { ok: true },
    });
    render(<FieldOps />, '/ceo/field-ops');
    expect(await screen.findByText('On visit · Annapoorna Mess')).toBeInTheDocument();
    expect(screen.getByText('Kiran · BTM Layout')).toBeInTheDocument();
    expect(screen.getByText('12 min')).toBeInTheDocument();
    expect(screen.getByText('Kiran Kumar · 1.2 km')).toBeInTheDocument();
    const revisits = screen.getByRole('table', { name: 'Revisits due this week' });
    expect(within(revisits).getByText('Sri Ganesh Stores')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: /Assign the visit/ }));
    await waitFor(() => expect(api.calls('POST /businesses/b1/visit-assignments/va1/assign')[0].body).toEqual({ assignedStaffId: 'fa1' }));
  });

  it('joining & check-ins lists results', async () => {
    mockApi({ ...common, 'GET /ceo/check-ins': { rows: [{ id: 'j1', check: 'joining', due: NOW.toISOString(), placement: { id: 'p', code: 'PL-1' }, jobSeeker: { id: 'j', code: 'JS', name: 'Kavya S' }, business: { id: 'b', code: 'BZ', name: 'Greenwood Apts' }, result: 'Both calls answered · joined', tone: 'good', agent: null }], summary: { joinings: 1, joined: 1, checkInsDue: 0, checkInsDone: 0, overdue: 0 } } });
    render(<Checkins />, '/ceo/placements/check-ins');
    expect(await screen.findByText('Kavya S → Greenwood Apts')).toBeInTheDocument();
    expect(screen.getAllByText('Both calls answered · joined').length).toBeGreaterThan(0);
  });
});

describe('Audit, flags, privacy, system and notifications', () => {
  it('audit log filters on the server and pages', async () => {
    const api = mockApi({ ...common, 'GET /ceo/audit': { rows: [{ id: 'a1', code: 'AL-1', at: '2026-10-30T05:30:00Z', actor: { id: 'c', code: 'CEO', name: 'Agastya', role: 'ceo' }, type: 'policy', action: 'pricing_change', entityType: 'pricing', entityCode: 'v2', reason: null, change: 'offerReplyHours: 24 → 48' }], total: 1, page: 1, pageSize: 50, summary: null } });
    render(<AuditLog />, '/ceo/audit');
    expect(await screen.findByText('offerReplyHours: 24 → 48')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'money');
    await waitFor(() => expect(api.calls('GET /ceo/audit').at(-1)!.query.get('type')).toBe('money'));
  });

  it('flags resolve with a written outcome', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/flags': { rows: [{ id: 'f1', code: 'RFL-1', kind: 'bypass_suspected', subjectType: 'business', subjectId: 'b', subject: { code: 'BZ-1', name: 'Lakeview Bakery' }, raisedFor: null, details: { note: 'candidate says he works there' }, severity: 'high', owner: 'Ravi Shankar', status: 'open', raisedAt: NOW.toISOString(), resolvedBy: null, resolution: null }], total: 1, page: 1, pageSize: 25, summary: { open: 6, high: 1, medium: 3, low: 2, closedThisMonth: 14 }, kinds: ['bypass_suspected'] },
      'POST /review-flags/f1/resolve': { ok: true },
    });
    render(<Flags />, '/ceo/flags');
    expect(await screen.findByText('Lakeview Bakery')).toBeInTheDocument();
    expect(screen.getAllByText('High').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText(/What you found/), 'Called both; fee collected');
    await userEvent.click(within(d).getByRole('button', { name: 'Resolve RFL-1' }));
    await waitFor(() => expect(api.calls('POST /review-flags/f1/resolve')[0].body).toEqual({ status: 'resolved', resolution: 'Called both; fee collected' }));
  });

  it('privacy shows consent by purpose and withdrawals, and pages the consent records', async () => {
    mockApi({
      ...common,
      'GET /ceo/privacy': { summary: { fullConsent: 320, withdrawalsThisMonth: 4, erasuresThisMonth: 0, noticeVersion: '3' }, purposes: [{ purpose: 'call_recording', required: true, given: 320, withdrawn: 2 }], withdrawals: [{ id: 'w', at: '2026-10-28T05:00:00Z', subjectType: 'job_seeker', subjectCode: 'JS-00133', purpose: 'call_recording', method: 'call', effect: 'Profile paused' }], erasures: [], noticeVersions: [{ version: '3', count: 10, firstAt: '2026-11-01T00:00:00Z', lastAt: NOW.toISOString() }], businesses: { total: 54, signedAndRecording: 54 }, partners: { total: 22, termsAndRecording: 20 } },
      'GET /ceo/privacy/consents': { rows: [], total: 0, page: 1, pageSize: 25, summary: null },
      'GET /data-requests': { dueDays: 30, summary: { open: 0, overdue: 0, closedThisMonth: 0 }, rows: [] },
    });
    render(<Privacy />, '/ceo/privacy');
    expect(await screen.findByText('Profile paused')).toBeInTheDocument();
    expect(screen.getByText('20 of 22 · 2 pending')).toBeInTheDocument();
    expect(screen.getAllByText('Record calls').length).toBeGreaterThan(0);
  });

  it('system health shows services and runs a nightly job', async () => {
    const api = mockApi({
      ...common,
      'GET /system/status/details': { status: 'degraded', timestamp: NOW.toISOString(), uptimeFormatted: '2d 3h', environment: 'production', version: '1.0.0', idCheck: { status: 'up', lastChangedAt: null }, components: [{ name: 'Database', status: 'healthy', latencyMs: 4 }, { name: 'Redis', status: 'degraded', message: 'slow' }] },
      'GET /ceo/system': { messages: { sent: 100, delivered: 97, failed: 3, byChannel: [], byTemplate: [] }, otps: { sent: 214, verified: 211 }, jobs: [{ key: 'followUp', label: 'Follow-up calls created', runsAt: '06:00', lastRunAt: null, result: null, runPath: '/jobs/follow-up/run' }], intervals: [] },
      'POST /jobs/follow-up/run': { ok: true },
    });
    render(<SystemScreen />, '/ceo/system');
    expect(await screen.findByText('Slow')).toBeInTheDocument();
    expect(screen.getByText('214')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: /Run "Follow-up calls created" now/ }));
    await waitFor(() => expect(api.calls('POST /jobs/follow-up/run')).toHaveLength(1));
  });

  it('notifications list new and done, filter by type and mark them seen', async () => {
    const n = (id: string, kind: string, title: string, status: 'open' | 'cleared') => ({ id, kind, title, body: null, link: '/ceo/refunds', subjectType: 'x', subjectId: id, status, seen: false, createdAt: '2026-11-09T06:30:00Z', seenAt: null, clearedAt: status === 'cleared' ? '2026-11-11T06:28:00Z' : null, clearedReason: null, clearedBy: status === 'cleared' ? { id: 'm', code: 'M', name: 'Priya Sharma', role: 'manager' } : null });
    const api = mockApi({ ...common, 'GET /notifications': { openCount: 1, unseenCount: 1, total: 2, items: [n('1', 'refund_needs_ceo', '4 refunds waiting for your approval', 'open'), n('2', 'leave_request', 'Leave request', 'cleared')], asOf: NOW.toISOString() }, 'POST /notifications/seen': { ok: true } });
    render(<Notifications />, '/ceo/notifications');
    expect(await screen.findByText('4 refunds waiting for your approval')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('POST /notifications/seen')).toHaveLength(1));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'money');
    expect(screen.queryByText('Leave request')).not.toBeInTheDocument();
  });
});

const policy = { id: 'p1', activationFeePaise: 49900, placementFeePercent: 50, gstPercent: 18, jobSeekerGuaranteeDays: 30, maxHits: 3, offerReplyHours: 48, interviewResultDeadline: '20:00', placementPaymentDueHours: 24, replacementWindowDays: 60, maxFreeReplacements: 2, replacementSearchDays: 15, noBypassMonths: 12, noBypassPenaltyPercent: 50, referralPayoutPaise: 20000, joiningRewardPaise: 20000, joiningRewardAfterDays: 30, callingHoursStart: '09:00', callingHoursEnd: '21:00', shiftStart: '09:30', shiftEnd: '18:30', productionHoursFullDay: 8, halfDayBelowHours: 4.5, dayToleranceMinutes: 10, lateGraceMinutes: 10, shortBreakMinutes: 15, lunchMinutes: 30, idleAfterMinutes: 10, casualLeavePerMonth: 1, emergencyLeavePerMonth: 1, financeBusinessRefundLimitPaise: 1500000, financeExpenseLimitPaise: 1000000, weeklyOffDays: [0], registrationLinkValidHours: 48, paymentOnlyLinkMinutes: 20, behindPaceStartDay: 8, behindPaceThresholdPercent: 80 };

describe('Pricing & policy', () => {
  it('shows every rule in force, schedules a change for a later date, sets the weekly day off and adds a holiday', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/pricing/history': { current: policy, since: { offerReplyHours: '2026-10-01T00:00:00Z' }, scheduled: [], history: [{ id: 'v2', effectiveFrom: '2026-11-02T00:00:00Z', setBy: 'Agastya', changes: [{ field: 'noBypassPenaltyPercent', before: 0, after: 50 }] }] },
      'GET /attendance/holidays': { year: 2026, holidays: [{ id: 'h1', date: '2026-11-01', name: 'Kannada Rajyotsava', weekday: 0 }] },
      'POST /pricing': { ok: true },
      'POST /attendance/holidays': { ok: true },
    });
    render(<Pricing />, '/ceo/pricing');
    expect(await screen.findByText('₹499 · no GST')).toBeInTheDocument();
    expect(screen.getByText(/9:30 AM – 6:30 PM · 8 production hours/)).toBeInTheDocument();
    expect(screen.getByText(/No-bypass · Penalty % on top of the fee 0 → 50/)).toBeInTheDocument();
    expect(await screen.findByText(/Kannada Rajyotsava/)).toBeInTheDocument();
    expect(screen.getByText('48 hours · payment-only link 20 minutes')).toBeInTheDocument();
    expect(screen.getByText("From day 8 · below 80% of the target's pace")).toBeInTheDocument();

    const row = screen.getByText('Offer reply time').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Change →' }));
    const d = await dialog();
    const hours = within(d).getByLabelText(/^Hours/);
    await userEvent.clear(hours);
    await userEvent.type(hours, '24');
    fireEvent.change(within(d).getByLabelText(/Starts on/), { target: { value: '2026-12-01' } });
    await userEvent.click(within(d).getByRole('button', { name: 'Schedule change' }));
    await waitFor(() => expect(api.calls('POST /pricing')[0].body).toEqual({ offerReplyHours: 24, effectiveFrom: '2026-11-30T18:30:00.000Z' }));

    const off = screen.getByText('Weekly day off').closest('tr') as HTMLElement;
    await userEvent.click(within(off).getByRole('button', { name: 'Change →' }));
    const d2 = await dialog();
    await userEvent.click(within(d2).getByLabelText('Saturday'));
    await userEvent.click(within(d2).getByRole('button', { name: 'Weekly day off' }));
    await waitFor(() => expect(api.calls('POST /pricing')[1].body).toEqual({ weeklyOffDays: [0, 6] }));

    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-12-25' } });
    await userEvent.type(screen.getByLabelText(/^Holiday/), 'Christmas');
    await userEvent.click(screen.getByRole('button', { name: '+ Add holiday' }));
    await waitFor(() => expect(api.calls('POST /attendance/holidays')[0].body).toEqual({ date: '2026-12-25', name: 'Christmas' }));
  });

  it('shows the go-live date (CEO only) and sets it: payroll and paid leave count from it', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/pricing/history': { current: { ...policy, goLiveDate: null }, since: {}, scheduled: [], history: [] },
      'GET /attendance/holidays': { year: 2026, holidays: [] },
      'PUT /pricing/go-live': { ok: true },
    });
    render(<Pricing />, '/ceo/pricing');
    const row = (await screen.findByText('Go-live date')).closest('tr') as HTMLElement;
    expect(within(row).getByText('not set')).toBeInTheDocument();
    expect(within(row).getByText(/never absent/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Change →' }));
    const d = await dialog();
    fireEvent.change(within(d).getByLabelText(/starts using the software on/), { target: { value: '2026-11-20' } });
    await userEvent.click(within(d).getByRole('button', { name: 'Save go-live date' }));
    await waitFor(() => expect(api.calls('PUT /pricing/go-live')[0].body).toEqual({ goLiveDate: '2026-11-20' }));
  });

  it('shows a go-live date that is set', async () => {
    mockApi({
      ...common,
      'GET /ceo/pricing/history': { current: { ...policy, goLiveDate: '2026-11-20T00:00:00.000Z' }, since: { goLiveDate: '2026-11-12T10:00:00.000Z' }, scheduled: [], history: [] },
      'GET /attendance/holidays': { year: 2026, holidays: [] },
    });
    render(<Pricing />, '/ceo/pricing');
    const row = (await screen.findByText('Go-live date')).closest('tr') as HTMLElement;
    expect(within(row).getByText('20 Nov 2026')).toBeInTheDocument();
  });

  it('trades show pool and open positions; a typed trade is mapped to a listed one', async () => {
    const api = mockApi({
      ...common,
      'GET /trades/manage': [{ id: 't1', name: 'Electrician', nameKey: 'electrician', salaryMinPaise: 2100000, salaryMaxPaise: 3200000, minimumWageLevel: 'skilled', active: true, sortOrder: 0 }],
      'GET /trades/suggestions': [{ id: 's1', typedName: 'Wireman', typedByStaffId: 'fa1', status: 'waiting', subjects: [{}] }],
      'GET /ceo/pricing/trades': { rows: [{ nameKey: 'electrician', candidates: 22, openVacancies: 4 }] },
      'GET /ceo/team': { rows: [{ id: 'fa1', name: 'Kiran Kumar' }] },
      'POST /trades/suggestions/s1/map': { ok: true },
    });
    render(<Trades />, '/ceo/pricing/trades');
    expect(await screen.findByText('₹21,000 – ₹32,000')).toBeInTheDocument();
    expect(await screen.findByText('22')).toBeInTheDocument();
    expect(await screen.findByText(/“Wireman” · Kiran Kumar/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Map to…' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: /Map “Wireman”/ }));
    await waitFor(() => expect(api.calls('POST /trades/suggestions/s1/map')[0].body).toEqual({ tradeId: 't1' }));
  });

  it('areas: lists counts, adds an area and merges a duplicate', async () => {
    const area = (id: string, name: string, pin: string) => ({ id, name, pincode: pin, latitude: 12.9, longitude: 77.6, active: true, mergedInto: null, businesses: 14, jobSeekers: 22, openVacancies: 4 });
    const api = mockApi({
      ...common,
      'GET /areas/manage': { rows: [area('a1', 'BTM 2nd Stage', '560076'), area('a2', 'BTM Layout', '560076')], total: 2 },
      'POST /areas': { id: 'a3' },
      'POST /areas/a1/merge': { moved: { jobSeeker: 3, business: 1 } },
    });
    render(<Areas />, '/ceo/pricing/areas');
    expect(await screen.findByText('BTM Layout')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Merge areas' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Merge a duplicate into another area' }));
    await waitFor(() => expect(api.calls('POST /areas/a1/merge')[0].body).toEqual({ intoId: 'a2' }));
    expect(await screen.findByText('Merged · 4 records moved')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Add area' }));
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText(/Area name/), 'Begur');
    await userEvent.type(within(d).getByLabelText(/Pincode/), '560068');
    await userEvent.type(within(d).getByLabelText(/latitude/), '12.88');
    await userEvent.type(within(d).getByLabelText(/longitude/), '77.62');
    await userEvent.click(within(d).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /areas')[0].body).toEqual({ name: 'Begur', pincode: '560068', latitude: 12.88, longitude: 77.62 }));
  });

  it('minimum wage shows the figures and how many vacancies sit below', async () => {
    mockApi({ ...common, 'GET /ceo/pricing/minimum-wage': { effectiveFrom: '2026-05-22T00:00:00Z', unskilledPaise: 2337600, semiSkilledPaise: 2571400, skilledPaise: 2828600, highlySkilledPaise: 3111400, openVacancies: 12, belowMinimum: 7, belowMinimumOwnerTold: 5 } });
    render(<MinimumWage />, '/ceo/pricing/minimum-wage');
    expect(await screen.findByText('₹23,376 a month basic')).toBeInTheDocument();
    expect(screen.getByText('7 of 12 open (5 with owner told)')).toBeInTheDocument();
  });

  it('keeping data runs a dry run and shows what would happen', async () => {
    const summary = { executedAt: NOW.toISOString(), dryRun: true, profilesAnonymised: { jobSeekers: 2, businesses: 1, referrals: 0, total: 3, refused: 1 }, recordingsDeleted: 41, recordingsProtected: 0, accessLogsDeleted: { sessions: 200, loginCodeRequests: 12, total: 212 }, moneyRecordsDeleted: { total: 0 }, publicLinksDeleted: 0, otpSessionsDeleted: 0, jobRunsDeleted: 37 };
    const api = mockApi({ ...common, 'GET /retention/summary': null, 'POST /retention/dry-run': summary });
    render(<KeepingData />, '/ceo/pricing/data');
    expect(await screen.findByText('The clean-up has not run yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dry run — show what would happen' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Dry run of the clean-up' }));
    expect(await screen.findByText('3 (2 job seekers, 1 businesses, 0 partners)')).toBeInTheDocument();
    expect(screen.getByText('Old job run logs deleted')).toBeInTheDocument();
    expect(screen.getByTestId('job-runs-deleted')).toHaveTextContent('37');
    expect(api.calls('POST /retention/dry-run')).toHaveLength(1);
  });

  it('keeping data shows the job run logs the last run deleted, next to the other counts', async () => {
    const last = { executedAt: NOW.toISOString(), dryRun: false, profilesAnonymised: { jobSeekers: 0, businesses: 0, referrals: 0, total: 0, refused: 0 }, recordingsDeleted: 4, recordingsProtected: 0, accessLogsDeleted: { sessions: 1, loginCodeRequests: 1, total: 2 }, moneyRecordsDeleted: { total: 0 }, publicLinksDeleted: 3, otpSessionsDeleted: 2, jobRunsDeleted: 120 };
    mockApi({ ...common, 'GET /retention/summary': last });
    render(<KeepingData />, '/ceo/pricing/data');
    expect(await screen.findByTestId('job-runs-deleted')).toHaveTextContent('120');
    expect(screen.getByText("Deleted after 90 days · each job's latest run kept")).toBeInTheDocument();
  });
});

describe('Referral partner pause', () => {
  it('pauses with a reason, and shows Unpause on a paused partner', async () => {
    const detail = { id: 'r1', code: 'RF-00014', name: 'Manju', phone: '+919845012345', type: 'individual', role: 'auto_driver', businessName: null, area: 'BTM', createdAt: NOW.toISOString(), paused: null, registeredBy: null, terms: null, identity: null, payoutAccount: null, counts: { referred: 1, registered: 1, joined: 0, earnedPaise: 0, duePaise: 0, payoutPaise: 20000 }, payouts: [], referred: [] };
    const api = mockApi({ ...common, 'GET /ceo/referrals/r1': detail, 'POST /referrals/r1/pause': { ok: true } });
    render(<Partner />, '/ceo/referrals/r1', '/ceo/referrals/:id');
    await userEvent.click(await screen.findByRole('button', { name: 'Pause partner' }));
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText(/Reason/), 'Fake candidates');
    await userEvent.click(within(d).getByRole('button', { name: 'Pause Manju' }));
    await waitFor(() => expect(api.calls('POST /referrals/r1/pause')[0].body).toEqual({ reason: 'Fake candidates' }));
  });

  it('a paused partner shows the reason and Unpause', async () => {
    const detail = { id: 'r1', code: 'RF-00014', name: 'Manju', phone: '+919845012345', type: 'individual', role: null, businessName: null, area: null, createdAt: NOW.toISOString(), paused: { at: NOW.toISOString(), reason: 'Fake candidates' }, registeredBy: null, terms: null, identity: null, payoutAccount: null, counts: { referred: 0, registered: 0, joined: 0, earnedPaise: 0, duePaise: 0, payoutPaise: 20000 }, payouts: [], referred: [] };
    const api = mockApi({ ...common, 'GET /ceo/referrals/r1': detail, 'POST /referrals/r1/unpause': { ok: true } });
    render(<Partner />, '/ceo/referrals/r1', '/ceo/referrals/:id');
    expect(await screen.findByText(/Fake candidates/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unpause partner' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Unpause Manju' }));
    await waitFor(() => expect(api.calls('POST /referrals/r1/unpause')[0].body).toEqual({}));
  });
});
