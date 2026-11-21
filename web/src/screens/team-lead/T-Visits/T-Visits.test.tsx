import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import TeamLeadVisits from '.';

const NOW = new Date('2026-11-23T06:30:00Z');
const ravi = { id: 'staff-tl', code: 'TL-0003', name: 'Ravi Shankar', role: 'team_lead' };
const kiran = { id: 'fa-1', code: 'FA-00001', name: 'Kiran K', role: 'field_agent' };
const ravi2 = { id: 'fa-2', code: 'FA-00002', name: 'Ravi M', role: 'field_agent' };
const common = {
  'GET /team-lead/team': { lead: ravi, teamName: 'Team South', manager: null, members: [kiran, ravi2] },
  'GET /team-lead/visits': { date: '2026-11-23', summary: { visits: 0, toCheck: 0, signedUp: 0 }, rows: [] },
  'GET /businesses/visit-assignments': [],
  'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [] },
};

async function dialog() {
  return screen.findByRole('dialog');
}

describe('Visit proof (T-Visits): planned visits can be reassigned (21 Nov)', () => {
  it('shows who has each planned visit, marks leave, and reassigns with a reason', async () => {
    const api = mockApi({
      ...common,
      'GET /field-assignments/open': {
        assignments: [
          {
            id: 'va1', purpose: 'business_signup', createdAt: NOW.toISOString(), requestedFor: null,
            business: { id: 'b1', code: 'BZ-00007', name: 'Sri Sai Tiffins', locality: 'JP Nagar' },
            assignedStaff: { id: 'fa-1', code: 'FA-00001', name: 'Kiran K' }, assignedStaffOnLeave: true,
          },
        ],
        agents: [
          { id: 'fa-1', code: 'FA-00001', name: 'Kiran K', onLeaveToday: true },
          { id: 'fa-2', code: 'FA-00002', name: 'Ravi M', onLeaveToday: false },
        ],
      },
      'POST /field-assignments/va1/reassign': { assignmentId: 'va1', assignedStaffId: 'fa-2', onLeave: false },
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadVisits />, { portal: 'team-lead', path: '/team-lead/visits', now: NOW });
    expect(await screen.findByText('Sri Sai Tiffins · JP Nagar')).toBeInTheDocument();
    expect(screen.getAllByText('On leave today').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText(/Why it moves/), 'Kiran on leave');
    await userEvent.click(within(d).getByRole('button', { name: /Reassign the visit/ }));
    await waitFor(() =>
      expect(api.calls('POST /field-assignments/va1/reassign')[0].body).toEqual({ assignedStaffId: 'fa-2', reason: 'Kiran on leave', confirmLeave: false }),
    );
  });

  it("hands a field agent's work over until his last day away, and back", async () => {
    const api = mockApi({
      ...common,
      'GET /field-assignments/open': {
        assignments: [],
        agents: [
          { id: 'fa-1', code: 'FA-00001', name: 'Kiran K', onLeaveToday: true },
          { id: 'fa-2', code: 'FA-00002', name: 'Ravi M', onLeaveToday: false },
        ],
      },
      'POST /field-assignments/hand-over': { fromStaffId: 'fa-1', moved: [{ kind: 'revisit', recordId: 'v-1', toStaffId: 'fa-2' }], left: [], toOnLeave: [] },
      'POST /field-assignments/hand-back': { ended: 1 },
    });
    signInAs('team_lead');
    renderScreen(<TeamLeadVisits />, { portal: 'team-lead', path: '/team-lead/visits', now: NOW });
    await screen.findByText("Hand over a field agent's work");
    await userEvent.click((await screen.findAllByRole('button', { name: 'Hand over' }))[0]);
    const d = await dialog();
    await userEvent.selectOptions(within(d).getByLabelText('Hand over to'), 'fa-2');
    await userEvent.type(within(d).getByLabelText('Why the work moves'), 'Approved leave');
    await userEvent.click(within(d).getByRole('button', { name: 'Hand over' }));
    await waitFor(() => expect(api.calls('POST /field-assignments/hand-over')).toHaveLength(1));
    expect(api.calls('POST /field-assignments/hand-over')[0].body).toMatchObject({ fromStaffId: 'fa-1', toStaffId: 'fa-2', reason: 'Approved leave', until: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    await userEvent.click(screen.getAllByRole('button', { name: 'Hand back' })[0]);
    const back = await dialog();
    await userEvent.click(within(back).getByRole('button', { name: /is back/ }));
    await waitFor(() => expect(api.calls('POST /field-assignments/hand-back')[0].body).toEqual({ fromStaffId: 'fa-1' }));
  });
});
