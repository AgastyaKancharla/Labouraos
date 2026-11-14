import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../test/utils';
import TeamLeadAppSignups from '../team-lead/T-AppSignups';
import ManagerAppSignups from '../manager/MG-AppSignups';
import CeoAppSignups from '../ceo/C-AppSignups';
import { AppSignupBadgeFor } from './AppSignupBadge';
import type { SignupRow } from './appSignups';

const NOW = new Date('2026-12-02T05:30:00Z');
const funnel = {
  job_seeker: { A: 1, B: 2, C: 0, D: 0, E: 1, done: 0 },
  business: { A: 0, B: 1, C: 0, D: 0, E: 0, done: 0 },
  referral: { A: 0, B: 0, C: 0, D: 0, E: 0, done: 0 },
};
const counts = {
  now: NOW.toISOString(),
  started: 9,
  finished: 4,
  finishedWithoutHelpPercent: 75,
  medianMinutesToFinish: 95,
  openByStage: funnel,
  reachedStage: funnel,
  outcomes: {
    job_seeker: { open: 4, self: 3, assisted: 1, no_response: 0, gave_up: 0 },
    business: { open: 1, self: 0, assisted: 0, no_response: 0, gave_up: 0 },
    referral: { open: 0, self: 0, assisted: 0, no_response: 0, gave_up: 0 },
  },
  bySource: { store: 7, referral_link: 2 },
};

function row(over: Partial<SignupRow> = {}): SignupRow {
  return {
    id: 'su-1',
    kind: 'job_seeker',
    code: 'JS-01234',
    name: 'Ravi Kumar',
    maskedPhone: '******3210',
    area: 'Jayanagar',
    stage: 'E',
    stageReachedAt: '2026-12-01T09:30:00Z',
    step: 'payment_failed',
    missing: ['payment'],
    stuckReason: 'UPI failed 2 times',
    scriptHint: 'job_seeker.payment_failed',
    source: 'store',
    contactConsent: true,
    assignedTo: { id: 'ca-1', code: 'CA-0001', name: 'Sneha K' },
    assignmentReason: 'language',
    callTries: 1,
    remindersSent: 2,
    nextActionAt: null,
    openTask: { id: 't1', dueAt: '2026-12-02T04:00:00Z', overdue: true },
    outcome: 'open',
    startedAt: '2026-12-01T08:00:00Z',
    finishedAt: null,
    ...over,
  };
}

describe('Team Lead · App sign-ups', () => {
  it('lists the team’s sign-ups with stage, what is missing and overdue calls, and moves one to a teammate', async () => {
    signInAs('team_lead');
    const api = mockApi({
      'GET /signup-tracker/team-lead': {
        now: NOW.toISOString(),
        team: [
          { id: 'ca-1', code: 'CA-0001', name: 'Sneha K', spokenLanguages: ['Kannada'] },
          { id: 'ca-2', code: 'CA-0002', name: 'Imran P', spokenLanguages: ['Hindi'] },
        ],
        summary: { open: 1, overdue: 1, unassigned: 0, finished: 4, finishedWithoutHelpPercent: 75 },
        funnel,
        rows: [row()],
        unassigned: [],
        reengage: [row({ id: 'su-9', name: 'Old Lead', outcome: 'no_response', openTask: null, nextActionAt: '2027-01-01T03:30:00Z' })],
        seekerVisitRequests: [],
        areaTasks: [{ area: 'Jayanagar', count: 3, stages: { D: 3 } }],
      },
      'POST /signup-tracker/su-1/reassign': { id: 'su-1', assignedStaffId: 'ca-2' },
    });
    renderScreen(<TeamLeadAppSignups />, { now: NOW, portal: 'team-lead', path: '/team-lead/app-signups' });
    const table = await screen.findByRole('table', { name: "Your team's app sign-ups" });
    expect(await within(table).findByText('Ravi Kumar')).toBeInTheDocument();
    expect(within(table).getByText('Payment pending')).toBeInTheDocument();
    expect(within(table).getByText(/Still to do: Payment/)).toBeInTheDocument();
    expect(within(table).getByText('UPI failed 2 times')).toBeInTheDocument();
    expect(within(table).getByText(/Call overdue since/)).toBeInTheDocument();
    expect(screen.getByText('Jayanagar', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('No answer after 3 tries')).toBeInTheDocument();

    await userEvent.selectOptions(within(table).getByRole('combobox', { name: 'Move Ravi Kumar to' }), 'ca-2');
    await userEvent.click(within(table).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(api.calls('POST /signup-tracker/su-1/reassign')).toHaveLength(1));
    expect(api.calls('POST /signup-tracker/su-1/reassign')[0].body).toEqual({ staffId: 'ca-2' });
  });
});

describe('Manager · App sign-ups', () => {
  it('shows counts and funnels only: no names, no phone numbers, no rupees', async () => {
    signInAs('manager');
    mockApi({ 'GET /signup-tracker/manager': counts });
    const { container } = renderScreen(<ManagerAppSignups />, { now: NOW, portal: 'manager', path: '/manager/app-signups' });
    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText('2 h')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Open sign-ups by stage' })).toBeInTheDocument();
    expect(screen.getByText('App store')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/₹|\*{6}/);
  });
});

describe('CEO · App sign-ups', () => {
  it('shows funnels, areas, the list with filters and the timing rules in force', async () => {
    signInAs('ceo');
    const api = mockApi({
      'GET /signup-tracker/ceo': {
        ...counts,
        byArea: [{ area: 'Jayanagar', started: 5, finished: 2 }],
        areaTasks: [],
        seekerVisitRequests: [],
        rows: [row()],
        settings: {
          firstReminderMinutes: 30,
          secondReminderMinutes: 240,
          businessCallMinutes: 240,
          paymentStopWorkingMinutes: 120,
          maxCallTries: 3,
          callTryDays: 3,
          reengageDays: 30,
          areaClusterMin: 3,
          callingHoursStart: '09:00',
          callingHoursEnd: '21:00',
          workdayStart: '09:30',
          workdayEnd: '18:30',
          notYetInSettings: ['signupFirstReminderMinutes'],
        },
      },
    });
    renderScreen(<CeoAppSignups />, { now: NOW, portal: 'ceo', path: '/ceo/app-signups' });
    expect(await screen.findByRole('table', { name: 'All app sign-ups' })).toBeInTheDocument();
    expect(await screen.findByText(/30 minutes and 4 h after they stop/)).toBeInTheDocument();
    expect(screen.getByText(/3 calls over 3 working days/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'business');
    await waitFor(() => expect(api.calls('GET /signup-tracker/ceo').some((c) => c.query.get('kind') === 'business')).toBe(true));
  });
});

describe('"Registered in the app" label', () => {
  it('shows for a record self-registered in the app and nothing for others', async () => {
    signInAs('ceo');
    mockApi({ 'GET /signup-tracker/app-labels': { 'js-1': { registeredInApp: true, hasApp: true, pushOn: true } } });
    renderScreen(
      <div>
        <AppSignupBadgeFor type="job_seeker" id="js-1" />
        <span data-testid="other">
          <AppSignupBadgeFor type="job_seeker" id="js-2" />
        </span>
      </div>,
    );
    expect(await screen.findByText(/Registered in the app/)).toBeInTheDocument();
    expect(screen.getByTestId('other')).toBeEmptyDOMElement();
  });
});
