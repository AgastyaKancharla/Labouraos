import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import JobSeekersList from '../JobSeekers';
import NearRefund from '../C-NearRefund';
import RefundApprovals from '../C-Refunds';
import JobSeekerDetail from '../C-JobSeeker';
import BusinessDetail from '../C-Business';
import PlacementDetail from '../C-Placement';
import PaymentsIn from '../C-Payments';
import Claims from '../C-Claims';

const NOW = new Date('2026-11-11T06:30:00Z');
const common = { 'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [] };

const seeker = (i: number) => ({
  id: `js${i}`,
  code: `JS-0020${i}`,
  name: `Seeker ${i}`,
  phone: '+919845012412',
  trade: 'Electrician',
  salaryMinPaise: 1600000,
  salaryMaxPaise: 2000000,
  salaryPeriod: 'monthly',
  status: 'active',
  hits: 1,
  maxHits: 3,
  kyc: 'verified',
  paidAt: '2026-10-14T06:00:00Z',
  guaranteeDaysLeft: 2,
  registeredAt: '2026-10-13T06:00:00Z',
  registeredBy: 'Deepa Nair',
});

describe('CEO Job Seekers list', () => {
  it('shows tiles and rows from the server, sends filters, pages and downloads every matching row', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/job-seekers': ({ url }: { url: URL }) => {
        const size = Number(url.searchParams.get('pageSize'));
        const page = Number(url.searchParams.get('page'));
        const rows = Array.from({ length: Math.min(size, 30 - (page - 1) * size) }, (_, i) => seeker((page - 1) * size + i));
        return {
          rows,
          total: 30,
          page,
          pageSize: size,
          summary: { activeInPool: 128, registeredNotPaid: 92, waitingOnKyc: 14, withinFiveDaysOfRefund: 5, atTwoOfThreeHits: 3, deactivatedThisMonth: 7 },
          trades: ['Electrician', 'Cook'],
        };
      },
    });
    signInAs('ceo');
    renderScreen(<JobSeekersList />, { portal: 'ceo', path: '/ceo/job-seekers', now: NOW });
    expect(await screen.findByText('Showing 1–25 of 30')).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    // "+ Register job seeker" opens the one job seeker form inside the CEO portal.
    expect(screen.getByRole('link', { name: '+ Register job seeker' })).toHaveAttribute('href', '/ceo/register/job-seeker');
    expect(screen.getAllByText('2 days left')[0]).toBeInTheDocument();
    expect(api.calls('GET /ceo/job-seekers')[0].query.get('status')).toBe('active');

    await userEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(await screen.findByText('Showing 26–30 of 30')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Trade'), 'Cook');
    await waitFor(() => expect(api.calls('GET /ceo/job-seekers').at(-1)!.query.get('trade')).toBe('Cook'));
    expect(api.calls('GET /ceo/job-seekers').at(-1)!.query.get('page')).toBe('1');

    await userEvent.click(screen.getByRole('button', { name: 'Download (Excel)' }));
    await waitFor(() => expect(api.calls('GET /ceo/job-seekers').some((c) => c.query.get('pageSize') === '5000')).toBe(true));
  });

  it('shows the error with a retry', async () => {
    mockApi({ ...common, 'GET /ceo/job-seekers': apiError(500, 'Internal server error', 'req-9') });
    signInAs('ceo');
    renderScreen(<JobSeekersList />, { portal: 'ceo', path: '/ceo/job-seekers', now: NOW });
    expect(await screen.findByText('Reference: req-9')).toBeInTheDocument();
  });
});

describe('Close to a refund', () => {
  it('lists both sides, filters, and reminds the agent with the right record', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/near-refund': {
        windowDays: 15,
        rows: [
          { kind: 'job_seeker', id: 'js1', code: 'JS-00203', name: 'Ramesh Gowda', trade: 'Electrician', daysLeft: 2, bucket: '0-5', standing: { offers: 0, declined: 0, interviewsUpcoming: 0, replacementsOffered: 0, replacementsRejected: 0 }, agent: { id: 'a1', name: 'Deepa Nair' }, atStakePaise: 49900, recordId: 'js1', businessName: null },
          { kind: 'business', id: 'b1', code: 'PL-00072', name: 'Green Leaf Café', trade: 'Cook', daysLeft: 8, bucket: '6-10', standing: { offers: 0, declined: 0, interviewsUpcoming: 0, replacementsOffered: 1, replacementsRejected: 1 }, agent: { id: 'a2', name: 'Kiran Kumar' }, atStakePaise: 800000, recordId: 'pl1', businessName: 'Green Leaf Café' },
        ],
      },
      'POST /ceo/near-refund/remind': { created: true },
      'POST /calls': { id: 'c1' },
    });
    signInAs('ceo');
    renderScreen(<NearRefund />, { portal: 'ceo', path: '/ceo/job-seekers/near-refund', now: NOW });
    expect(await screen.findByText('JS-00203 · Ramesh Gowda')).toBeInTheDocument();
    expect(screen.getAllByText('₹8,000').length).toBeGreaterThan(0);
    expect(screen.getByText('1 replacement sent · 1 rejected')).toBeInTheDocument();

    const row = screen.getByText('PL-00072 · Green Leaf Café').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Remind the agent' }));
    await waitFor(() => expect(api.calls('POST /ceo/near-refund/remind')[0].body).toEqual({ kind: 'placement', id: 'pl1' }));
    expect(await within(row).findByText('Kiran Kumar has a priority call task')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Who'), 'job_seeker');
    expect(screen.queryByText('PL-00072 · Green Leaf Café')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Call' }));
    await waitFor(() => expect(api.calls('POST /calls')[0].body).toEqual({ subjectType: 'job_seeker', subjectId: 'js1', purpose: 'general' }));
  });
});

describe('Refund approvals', () => {
  const response = {
    items: [
      {
        id: 'p1',
        code: 'PAY-1',
        kind: 'business',
        amountPaise: 1770000,
        reason: 'above_finance_limit',
        outsideRules: false,
        note: null,
        sentAt: '2026-11-09T06:00:00Z',
        waitingDays: 2,
        sentBy: null,
        recordId: 'pl61',
        subject: { code: 'PL-00061', name: 'Hotel Annapoorna', businessId: 'b1' },
        evidence: { reportedWithinDeadline: true, feePaidInFull: true, replacementsOffered: 0, replacementsRejected: 0, searchDaysReached: true, searchDays: 15, guaranteeEndedReason: null },
        check: { eligible: true, reason: null },
      },
    ],
    summary: { waitingCount: 1, waitingPaise: 1770000, businessCount: 1, businessPaise: 1770000, jobSeekerCount: 0, jobSeekerPaise: 0, financeWithinLimitsPaise: 1043800, financeLimitPaise: 1500000, oldestWaitingDays: 2 },
  };

  it('shows the evidence and the software check, approves and rejects with a reason', async () => {
    const api = mockApi({ ...common, 'GET /ceo/refunds': response, 'POST /payments/p1/approve': { id: 'p1' }, 'POST /payments/p1/reject-refund': { id: 'p1' } });
    signInAs('ceo');
    renderScreen(<RefundApprovals />, { portal: 'ceo', path: '/ceo/refunds', now: NOW });
    expect(await screen.findByText(/It is here only because it is above ₹15,000/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open record' })).toHaveAttribute('href', '/ceo/placements/pl61');

    await userEvent.click(screen.getByRole('button', { name: 'Reject with reason' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reject the refund' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Owner rejected suitable candidates');
    await userEvent.click(confirm);
    await waitFor(() => expect(api.calls('POST /payments/p1/reject-refund')[0].body).toEqual({ reason: 'Owner rejected suitable candidates' }));

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Approve ₹17,700/ }));
    await waitFor(() => expect(api.calls('POST /payments/p1/approve')).toHaveLength(1));
  });

  it('says so when nothing is waiting', async () => {
    mockApi({ ...common, 'GET /ceo/refunds': { items: [], summary: { ...response.summary, waitingCount: 0 } } });
    signInAs('ceo');
    renderScreen(<RefundApprovals />, { portal: 'ceo', path: '/ceo/refunds', now: NOW });
    expect(await screen.findByText('Nothing is waiting for you.')).toBeInTheDocument();
  });
});

describe('Detail pages', () => {
  it('job seeker: shows the record and reverses a hit with a reason', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/job-seekers/js1': {
        id: 'js1',
        code: 'JS-00203',
        name: 'Ramesh Gowda',
        phone: '+919845012412',
        status: 'active',
        createdAt: '2026-10-01T05:00:00Z',
        guarantee: { days: 30, paidAt: '2026-10-14T06:00:00Z', daysLeft: 2, floorPaise: 1600000 },
        hits: { count: 1, max: 3 },
        offersMade: 2,
        interviews: 1,
        activation: { amountPaise: 49900, at: '2026-10-14T06:00:00Z', utr: '43210000', confirmedBy: 'bank_feed' },
        refunds: [],
        profile: { trades: [{ trade: 'Electrician', years: 4, primary: true }], locality: 'JP Nagar', travelDistanceKm: 8, salaryMinPaise: 1600000, salaryMaxPaise: 2000000, salaryPeriod: 'monthly', shiftPreference: 'day', jobType: 'full_time', languages: ['Kannada'], qualification: null, referredBy: null, registeredBy: { id: 's1', name: 'Deepa Nair' }, heardFrom: 'missed_call' },
        registration: { phoneVerified: true, consentsGranted: 5, consentsAsked: 5, consentAt: '2026-10-01T05:12:00Z', selfieAt: '2026-10-01T05:14:00Z', idCheck: { method: 'digilocker', last4: '6612', adult: true }, paymentAt: '2026-10-14T06:00:00Z' },
        hitList: [{ id: 'h1', reason: 'no_pickup', at: '2026-10-20T06:00:00Z', reversed: false, superseded: false }],
        activity: [{ at: '2026-10-20T06:00:00Z', business: null, businessId: null, what: 'no_pickup', status: 'hit', hit: true }],
        placements: [],
        history: [{ at: '2026-10-01T05:00:00Z', kind: 'registered', text: 'registered', by: 'Deepa Nair' }],
      },
      'POST /job-seeker-hits/h1/reverse': { id: 'h1' },
    });
    signInAs('ceo');
    renderScreen(<JobSeekerDetail />, { portal: 'ceo', path: '/ceo/job-seekers/js1', route: '/ceo/job-seekers/:id', now: NOW });
    expect(await screen.findByRole('heading', { level: 1, name: 'Ramesh Gowda · JS-00203' })).toBeInTheDocument();
    expect(screen.getByText('Day 28 of 30')).toBeInTheDocument();
    expect(screen.getByText(/Digilocker · last 4: 6612 · 18\+/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reverse a hit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Calls were outside his window');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse a hit' }));
    await waitFor(() => expect(api.calls('POST /job-seeker-hits/h1/reverse')[0].body).toEqual({ reversalReason: 'Calls were outside his window' }));
  });

  it('business: pauses with a reason', async () => {
    const api = mockApi({
      ...common,
      'GET /staff': [{ id: 'fa2', name: 'Arun S', role: 'field_agent', status: 'active' }],
      'GET /ceo/businesses/b1': {
        id: 'b1',
        code: 'BZ-00012',
        name: 'Sri Sai Hotel',
        legalName: 'Sri Sai Foods Pvt Ltd',
        phone: '+919900088812',
        gstNumber: '29ABCDE1234F1Z5',
        gstVerified: true,
        type: 'restaurant_hotel',
        employeeCount: 30,
        employeeCountBand: null,
        address: '27th Main, HSR Layout',
        hasPin: true,
        contact: { name: 'Prakash', role: 'manager', phone: '+919900088812', verified: true },
        branches: [],
        accountAgent: { id: 'fa1', name: 'Kiran Kumar', since: '2026-09-03T05:00:00Z' },
        heardFrom: 'field_visit',
        leadChannel: null,
        status: 'verified',
        pauseReason: null,
        noDocuments: false,
        createdAt: '2026-09-03T05:00:00Z',
        tiles: { openVacancies: 2, openPositions: 3, candidatesShown: 14, noBypassMonths: 12, interviews: 8, placements: 6, feesPaidPaise: 4800000, replacementsUsed: 1 },
        agreement: null,
        callRecordingConsent: true,
        vacancies: [],
        introductions: [],
        visits: [],
        history: [],
      },
      'POST /businesses/b1/pause': { id: 'b1' },
    });
    signInAs('ceo');
    renderScreen(<BusinessDetail />, { portal: 'ceo', path: '/ceo/businesses/b1', route: '/ceo/businesses/:id', now: NOW });
    expect(await screen.findByRole('heading', { level: 1, name: 'Sri Sai Hotel · BZ-00012' })).toBeInTheDocument();
    expect(screen.getByText('₹48,000')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pause business' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Check the GST');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause the business' }));
    await waitFor(() => expect(api.calls('POST /businesses/b1/pause')[0].body).toEqual({ reason: 'Check the GST' }));
  });

  it('placement: refuses a refund waiting with the CEO and keeps searching', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/placements/pl67': {
        id: 'pl67',
        code: 'PL-00067',
        status: 'dropped_out',
        stage: 'replacement',
        jobSeeker: { id: 'js144', code: 'JS-00144', name: 'Prakash N' },
        business: { id: 'b44', code: 'BZ-00044', name: 'Metro Mart' },
        vacancy: { id: 'v1', code: 'VC-1', tradeSkill: 'Security guard', roleTitle: null },
        salaryPaise: 1600000,
        feePaise: 800000,
        gstPaise: 144000,
        paidAt: '2026-10-01T06:00:00Z',
        invoiceCode: 'LAB/26-27/0063',
        feePayment: null,
        joinedDate: '2026-10-02T06:00:00Z',
        joiningCallsAnswered: true,
        referral: null,
        joiningReward: null,
        guarantee: { windowDays: 60, searchDays: 15, day: 41, endedReason: 'two_rejections', dropoutReportedAt: '2026-10-14T06:00:00Z', searchDaysLeft: null, maxReplacements: 2, maxRejections: 2, replacementsOffered: 3, replacementsRejected: 3 },
        claim: null,
        refund: { id: 'pay9', code: 'PAY-9', status: 'pending', amountPaise: 800000, withCeo: true, ceoApprovalReason: 'sent_by_finance' },
        chain: [],
        replacementCandidates: [],
        timeline: [{ at: '2026-10-01T06:00:00Z', text: 'selected', by: null }],
      },
      'POST /payments/pay9/reject-refund': { id: 'pay9' },
    });
    signInAs('ceo');
    renderScreen(<PlacementDetail />, { portal: 'ceo', path: '/ceo/placements/pl67', route: '/ceo/placements/:id', now: NOW });
    expect(await screen.findByText(/Guarantee paused/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve refund ₹8,000' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refuse — keep searching' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Candidates were suitable');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Refuse the refund' }));
    await waitFor(() => expect(api.calls('POST /payments/pay9/reject-refund')[0].body).toEqual({ reason: 'Candidates were suitable' }));
  });
});

describe('Money in and claims lists', () => {
  it('payments: asks for the selected period and shows the totals by type', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/payments/in': {
        rows: [{ id: 'p1', code: 'PAY-1', at: '2026-11-10T08:32:00Z', amountPaise: 49900, type: 'activation', method: 'upi_direct', reference: '4302911', confirmedBy: 'bank_feed', jobSeeker: { id: 'js1', code: 'JS-00214', name: 'Kavya S' }, business: null, placement: null }],
        total: 1,
        page: 1,
        pageSize: 25,
        summary: { receivedInclGstPaise: 53700000, matched: 1, unmatchedCredits: 3, amountMismatches: 1, duplicatesToRefund: 1 },
        byType: { activationPaise: 15968000, activationCount: 320, placementFeePaise: 32000000, placementCount: 40, gstPaise: 5760000, refundsPaidPaise: 1193500, netPaise: 46774500 },
        unmatched: [],
        unpaidFees: { withinDue: [], overdue: [] },
      },
    });
    signInAs('ceo');
    renderScreen(<PaymentsIn />, { portal: 'ceo', path: '/ceo/payments', now: NOW });
    expect(await screen.findByText('Kavya S · JS-00214')).toBeInTheDocument();
    expect(screen.getByText('₹4,67,745')).toBeInTheDocument();
    expect(screen.getByText('Matched automatically')).toBeInTheDocument();
    expect(api.calls('GET /ceo/payments/in')[0].query.get('fromDate')).toBe('2026-10-31T18:30:00.000Z');
  });

  it('claims: shows the decision and the search progress', async () => {
    mockApi({
      ...common,
      'GET /ceo/claims': {
        rows: [{ id: 'c1', code: 'RC-1', placement: { id: 'pl72', code: 'PL-00072' }, business: { id: 'b1', name: 'Green Leaf Café' }, reason: 'absent_3_days', leftOnDay: 12, reportedDaysAfterLeaving: 2, reportedWithinDeadline: true, feePaidInFull: true, decision: 'accepted', decidedBy: { name: 'Ravi Shankar', role: 'team_lead' }, overdue: false, rejectedReplacements: 0, search: { state: 'running', day: 4, of: 15 }, feePaise: 800000 }],
        total: 1,
        page: 1,
        pageSize: 25,
        summary: { thisMonth: 4, waitingForDecision: 1, searchesRunning: 2, refundableFromSearchPaise: 3776000, searchDays: 15 },
      },
    });
    signInAs('ceo');
    renderScreen(<Claims />, { portal: 'ceo', path: '/ceo/placements/claims', now: NOW });
    expect(await screen.findByText('Accepted by Ravi (TL)')).toBeInTheDocument();
    expect(screen.getByText('Day 4 of 15')).toBeInTheDocument();
    expect(screen.getByText('₹37,760')).toBeInTheDocument();
  });
});
