import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import JobSeekersList from '../JobSeekers';
import JobSeekerDetail from '../C-JobSeeker';
import PlacementsList from '../C-Placements';
import Interviews from '../C-Interviews';

/**
 * The CEO's pipeline lists and profiles reused in the Manager portal
 * (useRecordsPortal): the Manager's own endpoints, no money anywhere on the
 * page, and no CEO-only actions or links.
 */
const seekerRow = {
  id: 'js1', code: 'JS-00011', name: 'Ravi Kumar', phone: '******3210', trade: 'Cook', salaryMinPaise: 1500000, salaryMaxPaise: 2000000, salaryPeriod: 'monthly',
  status: 'lead', hits: 0, maxHits: 3, kyc: 'none', paidAt: null, guaranteeDaysLeft: null, registeredAt: '2026-11-15T05:00:00.000Z', registeredBy: 'Asha',
};

describe('Manager portal: pipeline lists and profiles', () => {
  it('Job Seekers reads /manager/job-seekers, opens on All, tiles set the filter, and the CEO-only buttons are gone', async () => {
    signInAs('manager');
    const api = mockApi({
      'GET /manager/job-seekers': {
        rows: [seekerRow], total: 1, page: 1, pageSize: 25, trades: ['Cook'],
        summary: { activeInPool: 0, registeredNotPaid: 1, waitingOnKyc: 0, withinFiveDaysOfRefund: 0, atTwoOfThreeHits: 0, deactivatedThisMonth: 0 },
      },
      'POST /app-signups/labels': {},
    });
    renderScreen(<JobSeekersList />, { portal: 'manager', path: '/manager/job-seekers' });
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(api.calls('GET /manager/job-seekers')[0].query.get('status')).toBeNull();
    expect(api.calls('GET /ceo/job-seekers')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: '+ Register job seeker' })).toBeNull();
    expect(screen.queryByText(/₹499/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Registered, not paid/ }));
    await waitFor(() => expect(api.calls('GET /manager/job-seekers').at(-1)!.query.get('status')).toBe('not_paid'));
    expect(screen.getByRole('link', { name: 'Open →' })).toHaveAttribute('href', '/manager/job-seekers/js1');
  });

  it('a job seeker profile shows no payment, refund or rupee figure for a Manager', async () => {
    signInAs('manager');
    mockApi({
      'GET /manager/job-seekers/js1': {
        id: 'js1', code: 'JS-00011', name: 'Ravi Kumar', phone: '******3210', status: 'active', createdAt: '2026-11-01T05:00:00.000Z',
        guarantee: { days: 30, paidAt: '2026-11-02T05:00:00.000Z', daysLeft: 10 },
        hits: { count: 0, max: 3 }, offersMade: 1, interviews: 0,
        profile: { trades: [{ trade: 'Cook', years: 2, primary: true }], locality: 'Jayanagar', pincode: '560041', travelDistanceKm: 5, salaryMinPaise: 1500000, salaryMaxPaise: 2000000, salaryPeriod: 'monthly', shiftPreference: 'day', jobType: 'full_time', languages: ['Kannada'], qualification: null, referredBy: null, registeredBy: { id: 's1', name: 'Asha' }, heardFrom: null, dateOfBirth: '1998-04-01', bestTime: { start: '10:00', end: '13:00' } },
        registration: { phoneVerified: true, consentsGranted: 3, consentsAsked: 3, consentAt: '2026-11-01T05:10:00.000Z', selfieAt: null, idCheck: null, paymentAt: '2026-11-02T05:00:00.000Z' },
        consents: [{ purpose: 'call_recording', granted: true, withdrawn: false, at: '2026-11-01T05:10:00.000Z' }],
        hitList: [], activity: [], placements: [], history: [],
      },
      'GET /legal/acceptances/job_seeker/js1': [],
      'GET /identity/job-seekers/js1/aadhaar-check': { status: 'none' },
      'POST /app-signups/labels': {},
    });
    renderScreen(<JobSeekerDetail />, { portal: 'manager', path: '/manager/job-seekers/js1', route: '/manager/job-seekers/:id' });
    expect(await screen.findByText('Ravi Kumar · JS-00011')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve refund early' })).toBeNull();
    expect(screen.queryByText(/Refunds/)).toBeNull();
    expect(screen.getByText('10:00 – 13:00')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Consent items' })).toHaveTextContent(/Call recording · Given/);
    // Only job salaries (allowed for a Manager) carry a rupee sign.
    const rupees = (document.body.textContent ?? '').match(/₹[\d,]+/g) ?? [];
    expect(rupees.every((r) => ['₹15,000', '₹20,000'].includes(r))).toBe(true);
  });

  it('Placements has no fee column, refund line or fee note for a Manager, and tiles set the stage', async () => {
    signInAs('manager');
    const api = mockApi({
      'GET /manager/placements': {
        rows: [{ id: 'p1', code: 'PL-00001', jobSeeker: { id: 'js1', code: 'JS-00011', name: 'Ravi Kumar' }, business: { id: 'b1', code: 'BZ-00001', name: 'Udupi Grand' }, trade: 'Cook', salaryPaise: 1800000, joinedDate: null, guaranteeDay: null, guaranteeDays: 60, replacementNumber: 0, stage: 'working' }],
        total: 1, page: 1, pageSize: 25,
        summary: { working: 1, joinedThisMonth: 0, inReplacementSearch: 0, pausedAfterRejections: 0, cleared: 0, stillWorkingAtDay60Percent: 0 },
        whyLeft: [], replacements: { freeThisMonth: 0, reachDeadlineIn3Days: 0, searchDays: 15 }, facets: { trades: ['Cook'] },
      },
    });
    renderScreen(<PlacementsList />, { portal: 'manager', path: '/manager/placements' });
    expect(await screen.findByText('Udupi Grand')).toBeInTheDocument();
    expect(screen.queryByText('Fee + GST')).toBeNull();
    expect(screen.queryByText(/GST/)).toBeNull();
    expect(screen.queryByText(/refundable/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Working now/ }));
    await waitFor(() => expect(api.calls('GET /manager/placements').at(-1)!.query.get('stage')).toBe('working'));
  });
});

describe('CEO Interviews: every row opens its vacancy, and tiles show their rows', () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id, code: `IV-${id}`, slotStartsAt: '2026-11-16T05:00:00.000Z', slotEndsAt: '2026-11-16T12:30:00.000Z',
    jobSeeker: { id: `js-${id}`, code: `JS-${id}`, name: `Seeker ${id}` }, trade: 'Cook', vacancy: { id: `vc-${id}`, code: `VC-${id}` },
    business: { id: 'b1', code: 'BZ-1', name: 'Udupi Grand' }, owner: 'Owner', type: 'walk_in', fieldAgent: null, status: 'confirmed', result: null,
    resultDueAt: '2026-11-16T14:30:00.000Z', overdue: false, offerSentAt: '2026-11-15T05:00:00.000Z', replyDueAt: '2026-11-17T05:00:00.000Z', candidateCheckAnswer: null, ...extra,
  });

  it('has an Open link to the vacancy on each row and the overdue tile filters the table', async () => {
    signInAs('ceo');
    mockApi({
      'GET /ceo/interviews': {
        summary: { today: 2, inRange: 2, resultsDueToday: 0, resultsOverdue: 1, mismatches: 0, awaitingReply: 0, noShowsThisWeek: 0 },
        rows: [row('1'), row('2')], resultsPending: [row('2', { overdue: true })], mismatches: [], awaitingReply: [],
      },
    });
    renderScreen(<Interviews />, { portal: 'ceo', path: '/ceo/interviews' });
    const open = await screen.findByRole('link', { name: 'Open VC-1 →' });
    expect(open).toHaveAttribute('href', '/ceo/vacancies/vc-1');
    await userEvent.click(screen.getByRole('button', { name: /Result overdue/ }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Open VC-1 →' })).toBeNull());
    expect(screen.getAllByRole('link', { name: 'Open VC-2 →' }).length).toBeGreaterThan(0);
  });
});
