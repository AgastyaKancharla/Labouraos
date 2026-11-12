import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import Requests from '../MG-Requests';
import Decided, { mondayOf } from '../MG-Decided';
import RequestDetail from '../MG-Req-Ravi';
import { WaitingCard } from '../MG-Home/WaitingCard';
import type { RequestDetail as Detail, RequestView } from './requests';

const NOW = new Date('2026-11-10T12:30:00Z'); // 18:00 IST, Tue 10 Nov
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
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const staff = {
  manager: { id: 'm1', code: 'MGR-2', name: 'Priya Sharma' },
  rows: [
    { id: 'tl1', code: 'TL-3', name: 'Ravi Shankar', role: 'team_lead', isIntern: false, team: 'Team South', teamLeadId: 'tl1' },
    { id: 'ca1', code: 'CA-1', name: 'Sneha K', role: 'call_agent', isIntern: false, team: 'Team South', teamLeadId: 'tl1' },
    { id: 'tl2', code: 'TL-4', name: 'Fatima Z', role: 'team_lead', isIntern: false, team: 'Team North', teamLeadId: 'tl2' },
    { id: 'ca2', code: 'CA-2', name: 'Vikram S', role: 'call_agent', isIntern: false, team: 'Team North', teamLeadId: 'tl2' },
  ],
};
const brief = (id: string) => {
  const r = staff.rows.find((x) => x.id === id)!;
  return { id: r.id, code: r.code, name: r.name, role: r.role };
};

function view(over: Partial<RequestView>): RequestView {
  return {
    ref: 'leave.l1',
    kind: 'leave',
    id: 'l1',
    title: 'Planned leave',
    summary: 'Thu 12 Nov – Fri 13 Nov · 2 days',
    about: null,
    person: brief('tl1'),
    requestedBy: brief('tl1'),
    reason: 'Family function in Mysuru',
    status: 'pending',
    where: 'with_manager',
    withTeamLead: false,
    withManager: true,
    withCeo: false,
    decider: 'manager',
    deciderStaff: { id: 'm1', code: 'MGR-2', name: 'Priya Sharma', role: 'manager' },
    routeReason: 'team_lead_own',
    routeReasonText: "Team Lead's own request",
    whyWithYou: 'team_lead_own',
    whyWithYouText: "Team Lead's own request",
    alert: null,
    createdAt: hoursAgo(5),
    dueAt: hoursAgo(-43),
    forwarded: null,
    decided: null,
    overturned: null,
    canDecide: true,
    canForward: false,
    canOverturn: false,
    details: { leaveKind: 'casual', fromDate: '2026-11-12', toDate: '2026-11-13', days: 2, casualDaysTakenThisMonth: 0, casualDaysPendingThisMonth: 0 },
    ...over,
  };
}

const ravi = view({});
const sneha = view({
  ref: 'leave.l2',
  id: 'l2',
  title: 'Emergency leave',
  summary: 'Wed 11 Nov · 1 day',
  person: brief('ca1'),
  requestedBy: brief('ca1'),
  reason: 'fever',
  withTeamLead: true,
  routeReason: 'team_lead',
  whyWithYou: 'team_lead_24h',
  whyWithYouText: "The Team Lead hasn't answered in 24 hours",
  createdAt: hoursAgo(26),
  details: { leaveKind: 'emergency', fromDate: '2026-11-11', toDate: '2026-11-11', days: 1 },
});
const vikram = view({
  ref: 'leave.l3',
  id: 'l3',
  summary: 'Mon 23 Nov – Fri 27 Nov · 5 days',
  person: brief('ca2'),
  requestedBy: brief('ca2'),
  reason: "Sister's wedding in Hubballi",
  routeReason: 'over_limit',
  whyWithYou: 'over_limit',
  whyWithYouText: 'More than 3 planned days in a month',
  alert: '7th planned days in November',
  createdAt: hoursAgo(2),
  details: { leaveKind: 'casual', fromDate: '2026-11-23', toDate: '2026-11-27', days: 5, casualDaysTakenThisMonth: 2, casualDaysPendingThisMonth: 0 },
});
const claim = view({
  ref: 'claim.c1',
  kind: 'claim',
  id: 'c1',
  title: 'Replacement claim',
  summary: 'worker let go on day 5',
  about: { type: 'placement', id: 'p1', code: 'PL-00080', name: 'Prestige Apts' },
  person: brief('ca1'),
  requestedBy: null,
  reason: null,
  routeReason: 'claim',
  whyWithYou: 'claim_24h',
  whyWithYouText: "The Team Lead hasn't decided in 24 hours",
  createdAt: hoursAgo(26),
  details: { hoursLeft: 22 },
});

describe('Requests (MG-Requests)', () => {
  it('lists what waits for the Manager with why, the counts, and approves one', async () => {
    const api = mockApi({
      ...common,
      'GET /requests/waiting': [ravi, sneha, vikram, claim],
      'GET /requests/open': [ravi, sneha, vikram, claim, view({ ref: 'leave.l9', id: 'l9', withCeo: true, canDecide: false })],
      'GET /manager/staff': staff,
      'POST /requests/leave.l1/decide': ravi,
    });
    const { container } = render(<Requests />, '/manager/requests');
    expect(await screen.findByText("A Team Lead's own leave — only a Manager decides")).toBeInTheDocument();
    expect(screen.getByText(/Ravi \(TL\) hasn't answered for 26 h\. It is still in Ravi's list too/)).toBeInTheDocument();
    expect(screen.getByText('More than 3 planned days in a month — comes to a Manager automatically')).toBeInTheDocument();
    expect(screen.getByText(/hasn't decided for 26 h · 22 h left of the 48-hour limit/)).toBeInTheDocument();
    expect(screen.getByText('PL-00080 · Prestige Apts')).toBeInTheDocument();
    expect(screen.getByText('Team Lead · South')).toBeInTheDocument();
    expect(screen.getByText('⚠ 7th planned days in November')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Waiting for you (4)' })).toBeInTheDocument();
    // Tiles: 4 waiting, 2 over 24 h, 1 with an alert, 1 gone to the CEO.
    expect(screen.getByText('Not answered by the Team Lead in 24 h').previousElementSibling?.textContent ?? screen.getByText('Not answered by the Team Lead in 24 h').parentElement?.textContent).toContain('2');
    expect(container.textContent).not.toMatch(/₹/);

    await userEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]);
    const d = await dialog();
    await userEvent.click(within(d).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.calls('POST /requests/leave.l1/decide')[0].body).toEqual({ decision: 'approved' }));
  });

  it('filters by type, team and search, and says when nothing matches', async () => {
    mockApi({ ...common, 'GET /requests/waiting': [ravi, sneha, vikram, claim], 'GET /requests/open': [], 'GET /manager/staff': staff });
    render(<Requests />, '/manager/requests');
    await screen.findByText('Vikram S');
    await userEvent.selectOptions(screen.getByLabelText('Team'), 'Team North');
    expect(screen.queryByText('Sneha K')).not.toBeInTheDocument();
    expect(screen.getByText('Vikram S')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Replacement claim');
    expect(await screen.findByText('No rows match these filters. Change a filter to see more.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Team'), '');
    expect(screen.getByText('PL-00080 · Prestige Apts')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), '');
    await userEvent.type(screen.getByLabelText('Search'), 'sneha');
    expect(screen.getByText('Sneha K')).toBeInTheDocument();
    expect(screen.queryByText('Vikram S')).not.toBeInTheDocument();
  });

  it('a reject needs a reason', async () => {
    const api = mockApi({ ...common, 'GET /requests/waiting': [vikram], 'GET /requests/open': [], 'GET /manager/staff': staff, 'POST /requests/leave.l3/decide': vikram });
    render(<Requests />, '/manager/requests');
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const d = await dialog();
    expect(within(d).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await userEvent.type(within(d).getByLabelText(/Reason/), 'Too many off that week');
    await userEvent.click(within(d).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.calls('POST /requests/leave.l3/decide')[0].body).toEqual({ decision: 'rejected', reason: 'Too many off that week' }));
  });

  it('shows empty and error states', async () => {
    mockApi({ ...common, 'GET /requests/waiting': [], 'GET /requests/open': [], 'GET /manager/staff': staff });
    const { unmount } = render(<Requests />, '/manager/requests');
    expect(await screen.findByText('Nothing is waiting for you.')).toBeInTheDocument();
    unmount();
    mockApi({ ...common, 'GET /requests/waiting': apiError(500, 'Internal server error', 'req-rq1'), 'GET /requests/open': [], 'GET /manager/staff': staff });
    render(<Requests />, '/manager/requests');
    expect((await screen.findAllByText('Reference: req-rq1')).length).toBeGreaterThan(0);
  });
});

describe('Decided this week (MG-Decided)', () => {
  const decidedByTl = view({
    ref: 'leave.l5',
    id: 'l5',
    person: brief('ca1'),
    requestedBy: brief('ca1'),
    status: 'rejected',
    where: 'decided',
    decided: { at: hoursAgo(30), by: brief('tl1'), role: 'team_lead', reason: 'Three people off that day' },
    canDecide: false,
    canOverturn: true,
  });
  const decidedByMe = view({
    ref: 'leave.l6',
    id: 'l6',
    status: 'approved',
    where: 'decided',
    decided: { at: hoursAgo(1), by: { id: 'm1', code: 'MGR-2', name: 'Priya Sharma', role: 'manager' }, role: 'manager', reason: 'Approved' },
    canDecide: false,
  });

  it('starts on Monday, shows who decided, filters, and overturns with a reason', async () => {
    const api = mockApi({ ...common, 'GET /requests/waiting': [ravi], 'GET /requests/decided': [decidedByMe, decidedByTl], 'GET /manager/staff': staff, 'POST /requests/leave.l5/overturn': decidedByTl });
    render(<Decided />, '/manager/requests/decided');
    expect(await screen.findByText('"Three people off that day"')).toBeInTheDocument();
    expect(api.calls('GET /requests/decided')[0].query.get('since')).toBe('2026-11-09');
    expect(screen.getByText('Ravi (Team Lead)')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Decided by'), 'You');
    expect(screen.queryByText('Ravi (Team Lead)')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Decided by'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Overturn' }));
    const d = await dialog();
    expect(within(d).getByRole('button', { name: 'Overturn' })).toBeDisabled();
    await userEvent.type(within(d).getByLabelText(/Why you are overturning/), 'Cover was arranged');
    await userEvent.click(within(d).getByRole('button', { name: 'Overturn' }));
    await waitFor(() => expect(api.calls('POST /requests/leave.l5/overturn')[0].body).toEqual({ reason: 'Cover was arranged' }));
  });

  it('works out Monday in India time', () => {
    expect(mondayOf(new Date('2026-11-15T19:00:00Z'))).toBe('2026-11-16'); // Mon 00:30 IST
    expect(mondayOf(new Date('2026-11-15T18:00:00Z'))).toBe('2026-11-09'); // Sun 23:30 IST
  });
});

describe('One request (MG-Req-*)', () => {
  const leave = {
    month: '2026-11',
    off: [{ id: 'x', staff: { id: 'ca9', name: 'Rahul M', role: 'call_agent' }, team: 'Team North', from: '2026-11-24', to: '2026-11-24', status: 'approved' }],
    balances: [{ staff: { id: 'ca2' }, plannedLeft: 7, emergencyLeft: 4, plannedUsedThisMonth: 2, emergencyUsedThisMonth: 0 }],
  };
  const agents = { rows: [{ staff: { id: 'ca2' }, attendancePercent: 86, lateLogins: 3 }] };

  it("over 3 planned days: says why, what to check, and approves the leave", async () => {
    const detail: Detail = { ...vikram, history: [{ at: vikram.createdAt, text: 'Vikram S asked: planned leave · Mon 23 Nov – Fri 27 Nov · 5 days' }] };
    const api = mockApi({ ...common, 'GET /requests/leave.l3': detail, 'GET /manager/staff': staff, 'GET /manager/leave': leave, 'GET /manager/agents': agents, 'POST /requests/leave.l3/decide': vikram, 'GET /requests/waiting': [] , 'GET /requests/open': [] });
    render(<RequestDetail />, '/manager/requests/leave.l3', '/manager/requests/:id');
    expect(await screen.findByText('Leave request · Vikram S')).toBeInTheDocument();
    expect(screen.getByText(/Vikram has already taken 2 planned leave days in November\. With these 5 days it becomes 7/)).toBeInTheDocument();
    expect(screen.getByText(/More than 3 planned leave days in a month come to a Manager automatically\. Fatima \(TL\) can see it but can't decide it\./)).toBeInTheDocument();
    expect(await screen.findByText('Planned 7 · emergency 4')).toBeInTheDocument();
    expect(screen.getByText('2 taken · with this, 7')).toBeInTheDocument();
    expect(screen.getByText('Rahul M')).toBeInTheDocument();
    expect(screen.getByText('86% · 3 late logins')).toBeInTheDocument();
    expect(screen.getByText(/Now · waiting for you · goes to the CEO if not answered by/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Approve leave' }));
    await waitFor(() => expect(api.calls('POST /requests/leave.l3/decide')[0].body).toEqual({ decision: 'approved' }));
  });

  it("a Team Lead's own leave, rejected with a note", async () => {
    const detail: Detail = { ...ravi, history: [] };
    const api = mockApi({ ...common, 'GET /requests/leave.l1': detail, 'GET /manager/staff': staff, 'GET /manager/leave': { ...leave, balances: [] }, 'GET /manager/agents': { rows: [] }, 'POST /requests/leave.l1/decide': ravi, 'GET /requests/waiting': [], 'GET /requests/open': [] });
    render(<RequestDetail />, '/manager/requests/leave.l1', '/manager/requests/:id');
    expect(await screen.findByText('Leave request · Ravi Shankar (Team Lead)')).toBeInTheDocument();
    expect(screen.getByText("Team Leads' leave goes straight to a Manager.")).toBeInTheDocument();
    expect(screen.getByText('Ravi Shankar · Team Lead · South')).toBeInTheDocument();
    expect(await screen.findByText('Other Team Leads off')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Note to them/), 'Month-end closing that week');
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.calls('POST /requests/leave.l1/decide')[0].body).toEqual({ decision: 'rejected', reason: 'Month-end closing that week' }));
  });

  it('shows the error with a retry', async () => {
    mockApi({ ...common, 'GET /requests/leave.l1': apiError(404, 'Not found', 'req-rq2'), 'GET /manager/staff': staff });
    render(<RequestDetail />, '/manager/requests/leave.l1', '/manager/requests/:id');
    expect((await screen.findAllByText('Reference: req-rq2')).length).toBeGreaterThan(0);
  });
});

describe('Command Center "Waiting for you"', () => {
  it('lists the oldest requests with Approve, Reject and Open', async () => {
    mockApi({ ...common, 'GET /requests/waiting': [sneha, ravi], 'GET /manager/staff': staff });
    render(<WaitingCard />, '/manager');
    expect(await screen.findByText('Sneha K')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All requests (2)' })).toBeInTheDocument();
    expect(screen.getByText('26 h')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute('href', '/manager/requests/leave.l2');
    expect(screen.getByText(/Agents' leave goes to their Team Lead first/)).toBeInTheDocument();
  });
});
