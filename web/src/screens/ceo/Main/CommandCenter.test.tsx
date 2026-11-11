import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import CommandCenter from './index';

const NOW = new Date('2026-11-11T13:00:00Z'); // Wednesday 11 Nov, 18:30 IST

const near = (count: number, atStakePaise: number) => ({ count, atStakePaise, buckets: { '0-5': count, '6-10': 0, '11-15': 0 } });

function ccRoutes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /ceo/command-center/money': {
      activationPaise: 99800,
      activationCount: 2,
      placementFeePaise: 800000,
      placementCount: 1,
      gstPaise: 144000,
      grossPaise: 899800,
      refundsPaidPaise: 49900,
      netPaise: 849900,
      receivedInclGstPaise: 1043800,
      changePercent: 18,
      refundExposure: { owedNowPaise: 849900, owedNowCount: 2, atRiskPaise: 249500, totalPaise: 1099400 },
      payouts: { duePaise: 40000, dueCount: 2, referralDueCount: 1, rewardDueCount: 1, failedCount: 1 },
    },
    'GET /ceo/command-center/pipeline': {
      jobSeekers: { registered: 412, stuckBeforePaying: 92, paid: 320, paidPercent: 78, offered: 96, accepted: 52, declined: 44, acceptedPercent: 54, joined: 40, joinedPercent: 77, closeToRefund: near(23, 1147700) },
      businesses: { fieldVisits: 88, signedUp: 58, vacanciesAdded: 40, openingsAdded: 58, filled: 40, fillPercent: 69, droppedOut: 5, replacingNow: 4, closeToRefund: near(4, 3776000) },
      windowDays: 15,
    },
    'GET /ceo/command-center/verticals': {
      jobSeekers: { activeInPool: 128, nearRefund: 5, atTwoHits: 3, waitingOnKyc: 14 },
      referrals: { partners: 22, individual: 15, business: 7, referredJoined: 9, payoutsDueCount: 6, payoutsDuePaise: 120000 },
      businesses: { active: 54, signedInRange: 3, geofenceFlagged: 1, topArea: 'Koramangala' },
      vacancies: { open: 12, positions: 20, over15Days: 3, replacements: 2, averageDaysToFill: 9 },
      placements: { working: 37, replacing: 4, paused: 1, cleared: 18 },
      payments: { receivedInclGstPaise: 53700000, failed: 2, processing: 3, settled: 360 },
      refunds: { waiting: 4, waitingPaise: 1987800, businessCount: 2, businessPaise: 1888000, jobSeekerCount: 2, jobSeekerPaise: 99800, oldestDays: 2 },
      callCenter: { callsToday: 63, connectPercent: 38, missedToReturn: 5 },
      fieldOps: { visitsToday: 14, vacanciesThisWeek: 9, geofenceToday: 1, agentsInField: 3 },
      team: { accounts: 11, twoFactorOnAllManagement: true, invitesPending: 2, signedInNow: 7 },
    },
    'GET /ceo/command-center/insights': {
      revenueByWeek: [
        { week: '2026-10-01', netPaise: 9200000 },
        { week: '2026-11-05', netPaise: 12600000 },
      ],
      joinedByWeek: [
        { week: '2026-10-01', count: 6 },
        { week: '2026-11-05', count: 12 },
      ],
      supplyDemand: [{ trade: 'Cook', pool: 9, open: 6 }],
      shortTrades: ['Cook'],
      team: { callAgents: [{ id: 'c1', name: 'Deepa Nair', calls: 22, connects: 9, connectPercent: 41 }], fieldAgents: [{ id: 'f1', name: 'Kiran Kumar', vacancies: 4, topArea: 'Koramangala' }] },
      openVacanciesByArea: [{ name: 'Koramangala', count: 4 }],
      openVacanciesTotal: 12,
      activity: [{ id: 'a1', at: '2026-11-11T12:58:00Z', actor: 'Priya Sharma', action: 'refund_approved', entityType: 'payment', entityCode: 'PL-00052' }],
      pricing: { activationFeePaise: 49900, guaranteeDays: 30, placementFeePercent: 50, gstPercent: 18, replacementWindowDays: 60, replacementSearchDays: 15, referralPayoutPaise: 20000, effectiveFrom: '2026-10-20T00:00:00Z' },
    },
    'GET /growth/money-under-guarantee': {
      range: {
        from: '2026-11-01',
        to: '2026-11-11',
        total: { receivedPaise: 1043800, couldGoBackPaise: 600000, safelyEarnedPaise: 443800, refundedPaise: 0 },
        activation: { receivedPaise: 99800, couldGoBackPaise: 99800, safelyEarnedPaise: 0, refundedPaise: 0 },
        placementFee: { receivedPaise: 944000, couldGoBackPaise: 500200, safelyEarnedPaise: 443800, refundedPaise: 0 },
      },
      asOfNow: { total: { receivedPaise: 0, couldGoBackPaise: 0, safelyEarnedPaise: 0, refundedPaise: 0 } },
    },
    'GET /growth/days-to-first-interview/summary': { minDays: 10, waitingCount: 7, waitingAnyDays: 30, oldestDays: 14 },
    'GET /system/status/details': { status: 'healthy', idCheck: { status: 'up' }, components: [{ name: 'PostgreSQL Database', status: 'healthy' }] },
    'GET /login-codes/pending': [],
    'GET /review-flags': [],
    'GET /refunds/due': [],
    ...overrides,
  };
}

function renderCC() {
  signInAs('ceo');
  return renderScreen(<CommandCenter />, { portal: 'ceo', path: '/ceo', now: NOW });
}

describe('CEO Command Center (Main.dc.html)', () => {
  it('greets the CEO and shows the money row computed by the server for the month', async () => {
    const api = mockApi(ccRoutes());
    renderCC();
    expect(screen.getByRole('heading', { level: 1, name: 'Good evening, Agastya' })).toBeInTheDocument();
    expect(screen.getByText('Money · November')).toBeInTheDocument();
    expect(await screen.findByTestId('cc-net')).toHaveTextContent('₹8,499');
    expect(screen.getByText('Gross ₹8,998 − refunds paid ₹499 · excludes GST')).toBeInTheDocument();
    expect(screen.getByText(/↑ 18% vs the period before/)).toBeInTheDocument();
    expect(screen.getByTestId('cc-exposure')).toHaveTextContent('₹10,994');
    expect(screen.getByTestId('cc-payouts')).toHaveTextContent('₹400');
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByTestId('cc-gst')).toHaveTextContent('₹1,440');
    expect(await screen.findByTestId('cc-under-guarantee')).toHaveTextContent('₹6,000');
    expect(await screen.findByTestId('cc-first-interview')).toHaveTextContent('7 paid job seekers with no interview 10+ days after paying');

    // One summary request for the selected range; no list is downloaded to add up in the browser.
    const q = api.calls('GET /ceo/command-center/money')[0].query;
    expect(q.get('fromDate')).toBe('2026-10-31T18:30:00.000Z');
    expect(q.get('toDate')).toBe('2026-11-11T18:29:59.999Z');
    expect(api.calls('GET /payments')).toHaveLength(0);
    expect(api.calls('GET /growth/money-under-guarantee')[0].query.get('from')).toBe('2026-11-01');
  });

  it('shows the pipeline, verticals, charts and health, every number linking to its list', async () => {
    mockApi(ccRoutes());
    renderCC();
    expect(await screen.findByRole('link', { name: /Registered\s*412/ })).toHaveAttribute('href', '/ceo/job-seekers');
    expect(screen.getByRole('link', { name: /Joined\s*40/ })).toHaveAttribute('href', '/ceo/placements');
    const near = screen.getAllByRole('link', { name: /Close to a refund · next 15 days/ });
    expect(near[0]).toHaveAttribute('href', '/ceo/job-seekers/near-refund');
    expect(near[0]).toHaveTextContent('₹11,477 at stake');
    expect(await screen.findByRole('link', { name: /Job Seekers.*128.*active in pool/s })).toHaveAttribute('href', '/ceo/job-seekers');
    expect(screen.getByRole('link', { name: /Refund Approvals.*waiting/s })).toHaveAttribute('href', '/ceo/refunds');
    expect(await screen.findByText('Priya Sharma approved refund')).toBeInTheDocument();
    expect(screen.getByText(/Short on cook/)).toBeInTheDocument();
    expect(screen.getByText('All running')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Net revenue/ })).toHaveAttribute('href', '/ceo/reports');
    expect(screen.getByRole('link', { name: /Payouts due/ })).toHaveAttribute('href', '/ceo/payments/out');
  });

  it('shows skeletons while loading', () => {
    mockApi(ccRoutes({ 'GET /ceo/command-center/money': () => new Promise(() => {}) }));
    renderCC();
    expect(screen.getByRole('link', { name: /Net revenue/ })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an error with the reference and retries with Refresh', async () => {
    let fail = true;
    const money = ccRoutes()['GET /ceo/command-center/money'];
    mockApi(ccRoutes({ 'GET /ceo/command-center/money': () => (fail ? apiError(500, 'Internal server error', 'req-77') : money) }));
    renderCC();
    expect(await screen.findByText('Reference: req-77')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(screen.getByTestId('cc-exposure')).toHaveTextContent('₹10,994'));
  });

  it('asks the server again when the period changes', async () => {
    const api = mockApi(ccRoutes());
    renderCC();
    await screen.findByTestId('cc-net');
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByText('Money · Today')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET /ceo/command-center/money').length).toBeGreaterThan(1));
    const last = api.calls('GET /ceo/command-center/money').at(-1)!.query;
    expect(last.get('fromDate')).toBe('2026-11-10T18:30:00.000Z');
  });
});
