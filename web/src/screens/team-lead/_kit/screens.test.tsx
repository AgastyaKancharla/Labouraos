import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import TeamLeadHome from '../T-Home';
import TeamLeadRequests from '../T-Requests';
import RequestDetailScreen from '../T-Req-Sneha';
import TeamLeadFlags from '../T-Flags';
import TeamLeadQuality from '../T-Quality';
import TeamLeadAttendance from '../T-Attendance';
import TeamLeadVerify from '../T-Verify';
import TeamLeadDecided from '../T-Decided';
import TeamLeadAgents from '../T-Agents';
import type { RequestView } from './api';

const NOW = new Date('2026-11-11T06:30:00Z');
const ravi = { id: 'staff-tl', code: 'TL-0003', name: 'Ravi Shankar', role: 'team_lead' };
const priya = { id: 'mg-1', code: 'MGR-0002', name: 'Priya Sharma', role: 'manager' };
const sneha = { id: 'ca-3', code: 'CA-0009', name: 'Sneha K', role: 'call_agent' };
const suresh = { id: 'fa-2', code: 'FA-0012', name: 'Suresh B', role: 'field_agent' };
const team = { lead: ravi, teamName: 'Team South', manager: priya, members: [sneha, suresh] };
const common = {
  'GET /team-lead/team': team,
  'GET /login-codes/pending': [],
  'GET /review-flags': [],
  'GET /requests/waiting': [],
  'GET /team-lead/quality': { checklist: [], summary: { toListen: 0, listenedThisMonth: 0, teamAverage: null, lowest: null }, picked: [], calls: [] },
  'GET /team-lead/registrations': { summary: { toCheck: 0, possibleDuplicates: 0, checkedThisMonth: 0, fakesThisMonth: 0 }, rows: [] },
  'GET /team-lead/visits': { date: '2026-11-11', summary: { visits: 0, toCheck: 0, signedUp: 0 }, rows: [] },
  'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [] },
};

function request(over: Partial<RequestView>): RequestView {
  return {
    ref: 'leave.l1',
    kind: 'leave',
    id: 'l1',
    title: 'Emergency leave',
    summary: 'Wed 11 Nov · 1 day',
    about: null,
    person: sneha,
    requestedBy: sneha,
    reason: 'fever',
    status: 'pending',
    where: 'with_team_lead',
    withTeamLead: true,
    withManager: false,
    withCeo: false,
    decider: 'team_lead',
    deciderStaff: ravi,
    routeReason: 'team_lead',
    routeReasonText: 'Sent to the Team Lead',
    whyWithYou: 'team_lead',
    whyWithYouText: 'Sent to the Team Lead',
    alert: null,
    createdAt: '2026-11-10T04:30:00Z',
    dueAt: null,
    forwarded: null,
    decided: null,
    overturned: null,
    canDecide: true,
    canForward: true,
    canOverturn: false,
    details: { leaveKind: 'emergency', fromDate: '2026-11-11', toDate: '2026-11-11', days: 1 },
    ...over,
  };
}

const pace = (target: number | null, done: number, projection: number, verdict: string | null, onTrack: boolean | null) => ({
  target,
  done,
  stillToDo: target === null ? null : target - done,
  needPerDay: target === null ? null : 0.9,
  doingPerDay: 0.8,
  daysLeft: 21,
  projection,
  verdict,
  onTrack,
});

describe('Team Lead home (T-Home)', () => {
  it("shows the team's month, the live board, today's counts, what is waiting and N2", async () => {
    mockApi({
      ...common,
      'GET /team-lead/targets': {
        year: 2026,
        month: 11,
        dayOfMonth: 9,
        daysInMonth: 30,
        daysLeft: 21,
        team: [
          { key: 'placed', label: 'People placed in jobs', hint: 'Each one earns a placement fee', ...pace(25, 7, 23, 'Short by 2', false) },
          { key: 'paid', label: 'Paid the ₹499 registration fee', hint: 'Job seekers who paid on their own phone', ...pace(180, 58, 193, 'Yes · 13 extra', true) },
        ],
        agents: [{ staff: suresh, mainLabel: 'People placed', second: { label: 'Repeat businesses', done: 0, target: null }, ...pace(8, 2, 7, 'Short by 1', false) }],
      },
      'GET /attendance/live': { asOf: NOW.toISOString(), counts: {}, people: [{ staff: sneha, status: 'available', since: null, loginAt: '2026-11-11T04:00:00Z', lateMinutes: 0, productionSeconds: 3600, breakSeconds: 0, breakOverSeconds: 0, overBreak: false, idle: false }] },
      'GET /team-lead/today': { asOf: NOW.toISOString(), totals: { calls: 153, registered: 13, paid: 6, visits: 10, businesses: 3, interviews: 4 }, agents: [{ staff: sneha, calls: 44, registered: 3, paid: 1, visits: 0, businesses: 0, interviews: 0 }] },
      'GET /requests/waiting': [request({})],
      'GET /growth/days-to-first-interview': { total: 1, rows: [{ jobSeekerId: 'j1', code: 'JS-00190', firstName: 'Prakash', trade: 'Driver', daysSincePaid: 12, daysLeftOnGuarantee: 18, registeredBy: sneha }] },
      'GET /growth/shortage-tasks': [],
      'GET /team-lead/work': { summary: { stuck: 0, followUpsOverdue: 0, interviewsToday: 0, resultsOverdue: 0 }, stuck: [] },
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadHome />, { portal: 'team-lead', path: '/team-lead', now: NOW });
    expect(await screen.findByText("At today's speed the team reaches 1 of 2 targets")).toBeInTheDocument();
    expect(screen.getByText(/Furthest behind: Suresh B/)).toBeInTheDocument();
    expect(screen.getByText('153')).toBeInTheDocument();
    expect(await screen.findByText('44 calls · 3 registered · 1 paid')).toBeInTheDocument();
    expect(screen.getByText('Short by 2')).toBeInTheDocument();
    expect(screen.getByText('Emergency leave')).toBeInTheDocument();
    expect(await screen.findByText('JS-00190 · Prakash')).toBeInTheDocument();
    expect(screen.getByText(/1 paid job seekers with no interview booked 10\+ days after paying/)).toBeInTheDocument();
  });

  it('shows an error with retry when the targets fail', async () => {
    const api = mockApi({ ...common, 'GET /team-lead/targets': apiError(500, 'Internal server error'), 'GET /attendance/live': { people: [] }, 'GET /team-lead/today': { totals: {}, agents: [] }, 'GET /growth/days-to-first-interview': { total: 0, rows: [] }, 'GET /growth/shortage-tasks': [], 'GET /team-lead/work': { summary: { stuck: 0, resultsOverdue: 0 }, stuck: [] } });
    signInAs('team_lead');
    renderScreen(<TeamLeadHome />, { portal: 'team-lead', path: '/team-lead', now: NOW });
    const retry = (await screen.findAllByRole('button', { name: /try again/i }))[0];
    await userEvent.click(retry);
    await waitFor(() => expect(api.calls('GET /team-lead/targets').length).toBeGreaterThan(1));
  });
});

describe('Requests (T-Requests)', () => {
  it('approves, rejects with a reason and sends to the Manager with a note', async () => {
    const api = mockApi({
      ...common,
      'GET /requests/open': [
        request({}),
        request({ ref: 'hit_removal.h1', kind: 'hit_removal', id: 'h1', title: 'Remove a hit', summary: '"no pickup" — at an interview', about: { type: 'job_seeker', id: 'j', code: 'JS-00205', name: 'Manjula' }, canForward: false, alert: '1st hit on them', details: { hitRecordedBy: 'Sneha K' } }),
        request({ ref: 'leave.l3', id: 'l3', person: ravi, title: 'Planned leave', canDecide: false, withTeamLead: false, withManager: true, where: 'with_manager', routeReasonText: "Team Lead's own request" }),
      ],
      'GET /requests/decided': [],
      'POST /requests/leave.l1/decide': ({ body }: { body: unknown }) => ({ ...request({}), status: (body as { decision: string }).decision }),
      'POST /requests/hit_removal.h1/decide': {},
      'POST /requests/leave.l1/forward': {},
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadRequests />, { portal: 'team-lead', path: '/team-lead/requests', now: NOW });
    expect(await screen.findByText('JS-00205 · Manjula')).toBeInTheDocument();
    expect(screen.getByText(/Team Lead's own request/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.calls('POST /requests/leave.l1/decide')[0].body).toEqual({ decision: 'approved' }));

    await userEvent.click(screen.getAllByRole('button', { name: 'Reject' })[1]);
    const reject = await screen.findByRole('dialog');
    expect(within(reject).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await userEvent.type(within(reject).getByRole('textbox'), 'The hit stands');
    await userEvent.click(within(reject).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.calls('POST /requests/hit_removal.h1/decide')[0].body).toEqual({ decision: 'rejected', reason: 'The hit stands' }));

    await userEvent.click(screen.getByRole('button', { name: 'Send to Manager' }));
    const fwd = await screen.findByRole('dialog');
    await userEvent.type(within(fwd).getByRole('textbox'), 'Busy week');
    await userEvent.click(within(fwd).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.calls('POST /requests/leave.l1/forward')[0].body).toEqual({ note: 'Busy week' }));
  });

  it('shows the empty state when nothing is waiting', async () => {
    mockApi({ ...common, 'GET /requests/open': [], 'GET /requests/decided': [] });
    signInAs('team_lead');
    renderScreen(<TeamLeadRequests />, { portal: 'team-lead', path: '/team-lead/requests', now: NOW });
    expect(await screen.findByText('Nothing is waiting for you.')).toBeInTheDocument();
  });
});

describe('One request (T-Req-Sneha) and Decided this week (T-Decided)', () => {
  it('needs a note to reject, and approves with the decide endpoint', async () => {
    const api = mockApi({
      ...common,
      'GET /requests/leave.l1': { ...request({ withManager: true }), history: [{ at: '2026-11-10T04:30:00Z', text: 'Sneha K asked: emergency leave' }] },
      'GET /attendance/leave/balance': { casual: { left: 3 }, emergency: { left: 2 } },
      'GET /team-lead/leave': { schedule: [] },
      'GET /team-lead/agents': { rows: [{ staff: { id: 'ca-3' }, attendance: { present: 7, workingDays: 7 }, lateLogins: { count: 1 } }] },
      'POST /requests/leave.l1/decide': {},
    });
    signInAs('team_lead');
    renderScreen(<RequestDetailScreen />, { portal: 'team-lead', path: '/team-lead/requests/leave.l1', route: '/team-lead/requests/:id', now: NOW });
    expect(await screen.findByText(/Priya \(Manager\) can now decide it too/)).toBeInTheDocument();
    expect(await screen.findByText('Planned 3 · emergency 2')).toBeInTheDocument();
    expect(await screen.findByText('7 of 7 days · 1 late login')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Approve leave' }));
    await waitFor(() => expect(api.calls('POST /requests/leave.l1/decide')[0].body).toEqual({ decision: 'approved' }));
  });

  it('lists who decided what this week, "You" for the Team Lead', async () => {
    mockApi({
      ...common,
      'GET /requests/decided': [
        request({ status: 'approved', where: 'decided', canDecide: false, decided: { at: '2026-11-11T05:00:00Z', by: ravi, role: 'team_lead', reason: 'Approved' } }),
        request({ ref: 'target_change.t1', kind: 'target_change', id: 't1', title: 'Target change', summary: 'People placed 12 → 15', status: 'rejected', where: 'decided', canDecide: false, decided: { at: '2026-11-06T05:00:00Z', by: priya, role: 'manager', reason: 'Keep 12 this month' } }),
      ],
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadDecided />, { portal: 'team-lead', path: '/team-lead/requests/decided', now: NOW });
    expect((await screen.findAllByText('You')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Priya (Manager)').length).toBeGreaterThan(0);
    expect(screen.getByText('"Keep 12 this month"')).toBeInTheDocument();
  });
});

describe('Flags (T-Flags)', () => {
  it('resolves a team flag and sends one to the Manager; a bypass shows "Goes to the CEO"', async () => {
    const flag = (id: string, kind: string, ownerRole: string, extra = {}) => ({ id, code: id, kind, title: kind === 'visit_short' ? 'Very short shop visit' : 'Possible bypass', subjectType: 'x', raisedFor: suresh, details: {}, status: 'open', raisedAt: NOW.toISOString(), ownerRole, owner: null, ceoDecides: kind === 'bypass_suspected', escalated: null, canResolve: ownerRole === 'team_lead', canEscalate: ownerRole === 'team_lead', ...extra });
    const api = mockApi({ ...common, 'GET /requests/flags': [flag('f1', 'visit_short', 'team_lead'), flag('f2', 'bypass_suspected', 'ceo')], 'POST /requests/flags/f1/escalate': {} });
    signInAs('team_lead');
    renderScreen(<TeamLeadFlags />, { portal: 'team-lead', path: '/team-lead/flags', now: NOW });
    expect(await screen.findByText('Goes to the CEO')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send to Manager' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Second short visit');
    await userEvent.click(within(dialog).getByRole('button', { name: /Send to Priya/ }));
    await waitFor(() => expect(api.calls('POST /requests/flags/f1/escalate')[0].body).toEqual({ note: 'Second short visit' }));
  });
});

describe('Listen to calls (T-Quality)', () => {
  it('opens the first picked call and saves the checklist score', async () => {
    const call = { id: 'c1', code: 'CR-1', agent: sneha, with: 'JS-00251 · Shivakumar', at: NOW.toISOString(), durationSec: 260, result: 'registered', picked: true, score: null };
    const api = mockApi({
      ...common,
      'GET /team-lead/quality': { checklist: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'], summary: { toListen: 1, listenedThisMonth: 0, teamAverage: null, lowest: null }, picked: [call], calls: [call] },
      'GET /calls/c1/recording': { url: 'https://example.invalid/rec.mp3', expiresInSeconds: 300 },
      'POST /team-lead/quality/c1/score': { score: 33 },
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadQuality />, { portal: 'team-lead', path: '/team-lead/quality', now: NOW });
    expect(await screen.findByText(/Score this call · Sneha K/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'One' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Three' }));
    expect(screen.getByText('Score: 33 / 100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Flag this call' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save score' }));
    await waitFor(() => expect(api.calls('POST /team-lead/quality/c1/score')[0].body).toEqual({ checks: [true, false, true, false, false, false], flag: false }));
  });
});

describe('Attendance (T-Attendance)', () => {
  it('changes a day with a reason through the requests backend', async () => {
    const api = mockApi({
      ...common,
      'GET /team-lead/attendance': { date: '2026-11-11', isToday: false, summary: { atWork: 1, people: 1, late: 0, overBreak: 0, secondsLost: 0 }, rows: [{ staff: sneha, dayId: 'd1', dayType: 'half', loginAt: '2026-11-10T04:00:00Z', lateMinutes: 0, productionSeconds: 15000, breakSeconds: 1800, overBreak: false, status: null, changesThisMonth: 0 }] },
      'POST /requests': { status: 'approved' },
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadAttendance />, { portal: 'team-lead', path: '/team-lead/attendance', now: NOW });
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: "Change Sneha K's day" }), 'full');
    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), 'System down');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('POST /requests')[0].body).toEqual({ kind: 'day_change', dayId: 'd1', dayType: 'full', reason: 'System down' }));
  });
});

describe('Check registrations (T-Verify) and Agents (T-Agents)', () => {
  it('flags a registration as fake with what looks wrong', async () => {
    const api = mockApi({
      ...common,
      'GET /team-lead/registrations': { summary: { toCheck: 1, possibleDuplicates: 1, checkedThisMonth: 38, fakesThisMonth: 2 }, rows: [{ jobSeeker: { id: 'r2', code: 'JS-00243', name: 'Venkatesh' }, trade: 'Security guard', registeredBy: sneha, paid: true, hasSelfie: false, idCheck: null, duplicates: ['JS-00118'], signals: ['Possible duplicate'], verdict: 'Possible duplicate' }] },
      'POST /team-lead/registrations/r2/check': { verdict: 'fake' },
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadVerify />, { portal: 'team-lead', path: '/team-lead/verify', now: NOW });
    expect(await screen.findByText('Yes · JS-00118')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fake · flag it' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Same face as JS-00118');
    await userEvent.click(within(dialog).getByRole('button', { name: /Flag JS-00243 as fake/ }));
    await waitFor(() => expect(api.calls('POST /team-lead/registrations/r2/check')[0].body).toEqual({ verdict: 'fake', note: 'Same face as JS-00118' }));
  });

  it('filters agents by role and shows "No rows match" when none fit', async () => {
    mockApi({
      ...common,
      'GET /team-lead/agents': { rows: [{ staff: sneha, main: { label: 'Paid the ₹499 fee', target: 45, done: 17, projection: 57, verdict: 'Yes · 12 extra', onTrack: true }, attendance: { present: 7, workingDays: 7 }, lateLogins: { count: 1, minutes: 4 }, leaveLeft: 5, callQuality: 85 }] },
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadAgents />, { portal: 'team-lead', path: '/team-lead/agents', now: NOW });
    expect(await screen.findByText('17 of 45')).toBeInTheDocument();
    expect(screen.getByText('85 / 100')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'field_agent');
    expect(await screen.findByText('No rows match these filters. Change a filter to see more.')).toBeInTheDocument();
  });
});
