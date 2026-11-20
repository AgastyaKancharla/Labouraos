import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import TeamLeadTargets from '.';

const NOW = new Date('2026-11-17T06:30:00Z');
const ravi = { id: 'staff-tl', code: 'TL-0003', name: 'Ravi Shankar', role: 'team_lead' };
const priya = { id: 'mg-1', code: 'MGR-0002', name: 'Priya Sharma', role: 'manager' };
const sneha = { id: 'ca-3', code: 'CA-0009', name: 'Sneha K', role: 'call_agent' };
const deepa = { id: 'ca-4', code: 'CA-0010', name: 'Deepa Nair', role: 'call_agent' };
const suresh = { id: 'fa-2', code: 'FA-0012', name: 'Suresh B', role: 'field_agent' };

const pace = (target: number | null, done: number) => ({ target, done, stillToDo: target === null ? null : Math.max(0, target - done), needPerDay: null, doingPerDay: 1, daysLeft: 13, projection: done * 2, verdict: target === null ? null : 'Short by 1', onTrack: false });
const KEYS = ['registered', 'paid', 'businessesSignedUp', 'vacancies', 'interviewsDone', 'placed', 'leftWithin30', 'repeatBusinesses'];
const plan = {
  year: 2026,
  month: 11,
  dayOfMonth: 17,
  daysInMonth: 30,
  editable: true,
  automatic: true,
  team: KEYS.map((key) => ({ key, label: `Label ${key}`, hint: `Hint ${key}`, handSet: key === 'placed', limit: key === 'leftWithin30', ...pace(key === 'paid' ? 60 : 10, 3) })),
  flags: [],
  agents: [
    { staff: sneha, workType: 'call', fields: [{ field: 'candidatesActivated', label: 'Paid registrations', target: 30, done: 12, handSet: true }, { field: 'vacanciesCaptured', label: 'Vacancies', target: 5, done: 1, handSet: false }] },
    { staff: deepa, workType: 'call', fields: [{ field: 'candidatesActivated', label: 'Paid registrations', target: 30, done: 4, handSet: false }, { field: 'vacanciesCaptured', label: 'Vacancies', target: 5, done: 0, handSet: false }] },
    { staff: suresh, workType: 'field', fields: [{ field: 'placementsClosed', label: 'Placements', target: 10, done: 2, handSet: false }, { field: 'repeatBusinesses', label: 'Repeat businesses', target: 2, done: 0, handSet: false }] },
  ],
  left: [],
};
const common = {
  'GET /team-lead/team': { lead: ravi, teamName: 'Team South', manager: priya, members: [sneha, deepa, suresh] },
  'GET /team-lead/targets': { year: 2026, month: 11, dayOfMonth: 17, daysInMonth: 30, daysLeft: 13, team: [], agents: [] },
  'GET /team-lead/targets/plan': plan,
  'GET /login-codes/pending': [],
  'GET /review-flags': [],
  'GET /requests/waiting': [],
  'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [] },
};

describe('T-Targets with the automatic split', () => {
  it("shows the team's eight numbers and each agent's share, Automatic or Set by hand; the Team Lead changes, resets and transfers", async () => {
    const api = mockApi({
      ...common,
      'PUT /team-lead/targets': plan,
      'POST /team-lead/targets/reset': { reset: ['candidatesActivated'] },
      'POST /team-lead/targets/transfer': { moved: { candidatesActivated: 18 }, from: sneha.id, to: deepa.id },
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadTargets />, { portal: 'team-lead', path: '/team-lead/targets', now: NOW });
    // The table (wide screens) and the stacked blocks (phones) both carry the eight numbers.
    expect((await screen.findAllByText('Label leftWithin30')).length).toBe(2);
    for (const key of KEYS) expect(within(screen.getByRole('list', { name: 'Team targets' })).getByText(`Label ${key}`)).toBeInTheDocument();
    expect(screen.getAllByText('Hint placed · set by hand by Priya (Manager)')).toHaveLength(2);
    expect(screen.getByText('Set by hand')).toBeInTheDocument();
    expect(screen.getAllByText('Automatic').length).toBe(5);
    // A field agent has no paid or vacancies input; a call agent no placements.
    expect(screen.queryByLabelText('Placements for Sneha K')).toBeNull();
    expect(screen.queryByLabelText('Paid registrations for Suresh B')).toBeNull();

    const input = screen.getByLabelText('Paid registrations for Deepa Nair');
    await userEvent.clear(input);
    await userEvent.type(input, '25');
    await userEvent.click(screen.getByRole('button', { name: 'Save targets' }));
    await waitFor(() => expect(api.calls('PUT /team-lead/targets')[0].body).toEqual({ year: 2026, month: 11, rows: [{ staffId: deepa.id, candidatesActivated: 25 }] }));

    await userEvent.click(screen.getByRole('button', { name: 'Reset Paid registrations for Sneha K to automatic' }));
    await waitFor(() => expect(api.calls('POST /team-lead/targets/reset')[0].body).toEqual({ year: 2026, month: 11, staffId: sneha.id, field: 'candidatesActivated' }));

    await userEvent.click(screen.getAllByRole('button', { name: 'Transfer target' })[0]);
    const d = await screen.findByRole('dialog');
    // Only agents of the same kind can receive it.
    expect(within(d).queryByRole('option', { name: 'Suresh B' })).toBeNull();
    await userEvent.selectOptions(within(d).getByLabelText('Agent who receives the target'), deepa.id);
    await userEvent.click(within(d).getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(api.calls('POST /team-lead/targets/transfer')[0].body).toEqual({ year: 2026, month: 11, fromStaffId: sneha.id, toStaffId: deepa.id }));
  });

  it('refusals from the server are shown as they are', async () => {
    mockApi({ ...common, 'PUT /team-lead/targets': { status: 400, body: { statusCode: 400, message: "Paid registrations: the agents' numbers set by hand add up to 70, more than Team South's 60. Lower one, or reset it to automatic." } } });
    signInAs('team_lead');
    renderScreen(<TeamLeadTargets />, { portal: 'team-lead', path: '/team-lead/targets', now: NOW });
    const input = await screen.findByLabelText('Paid registrations for Deepa Nair');
    await userEvent.clear(input);
    await userEvent.type(input, '40');
    await userEvent.click(screen.getByRole('button', { name: 'Save targets' }));
    expect(await screen.findByText(/more than Team South's 60/)).toBeInTheDocument();
  });
});
