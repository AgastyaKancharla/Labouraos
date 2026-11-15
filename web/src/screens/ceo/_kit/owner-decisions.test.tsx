import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import PlacementDetail from '../C-Placement';
import Claims from '../C-Claims';
import { BanButton } from './legal';

/** Owner decisions, Master Guide rev 178: M7/M9 bans, M2 unpaid salary difference, M10 paused claims. */
const NOW = new Date('2026-12-01T06:30:00Z');
const common = { 'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [] };
const ban = { banned: true, category: 'fraud', reason: 'x', bannedAt: '2026-11-20T06:00:00Z', viaProfile: { subjectType: 'job_seeker', code: 'JS-00001' }, profiles: [{ subjectType: 'job_seeker', code: 'JS-00001' }, { subjectType: 'referral', code: 'RF-00001' }] };

describe('Bans (M7, M9)', () => {
  it('shows a ban that came through another profile, and lets the CEO lift it with a reason', async () => {
    const api = mockApi({ 'GET /permanent-bans/referral/rf-1': ban, 'POST /permanent-bans/referral/rf-1/lift': { lifted: true } });
    signInAs('ceo');
    renderScreen(<BanButton subjectType="referral" subjectId="rf-1" name="Ravi" />);
    expect(await screen.findByText('Permanently banned')).toBeInTheDocument();
    expect(screen.getByText(/Through JS-00001/)).toBeInTheDocument();
    expect(screen.getByText(/Covers JS-00001, RF-00001/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lift ban' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Why it is lifted/), 'Police cleared him');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lift ban' }));
    await waitFor(() => expect(api.calls('POST /permanent-bans/referral/rf-1/lift')[0].body).toEqual({ reason: 'Police cleared him' }));
  });

  it('a Manager sees the ban but cannot lift it', async () => {
    mockApi({ 'GET /permanent-bans/referral/rf-1': ban });
    signInAs('manager');
    renderScreen(<BanButton subjectType="referral" subjectId="rf-1" name="Ravi" />);
    expect(await screen.findByText('Permanently banned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lift ban' })).not.toBeInTheDocument();
  });
});

describe('A replacement waiting for its salary difference (M2)', () => {
  it('"Cancel now" posts the reason', async () => {
    const api = mockApi({
      ...common,
      'GET /ceo/placements/pl90': {
        id: 'pl90', code: 'PL-00090', status: 'awaiting_payment', stage: 'awaiting_payment', salaryDifferencePaise: 200000,
        jobSeeker: { id: 'js1', code: 'JS-00001', name: 'Prakash N' }, business: { id: 'b44', code: 'BZ-00044', name: 'Metro Mart' },
        vacancy: { id: 'v1', code: 'VC-1', tradeSkill: 'Cook', roleTitle: null },
        salaryPaise: 2200000, feePaise: 100000, gstPaise: 18000, paidAt: null, invoiceCode: null, feePayment: null, joinedDate: null, joiningCallsAnswered: false,
        referral: null, joiningReward: null,
        guarantee: { windowDays: 60, searchDays: 15, day: null, endedReason: null, dropoutReportedAt: null, searchDaysLeft: null, maxReplacements: 2, maxRejections: 2, replacementsOffered: 1, replacementsRejected: 0 },
        claim: null, refund: null, chain: [], replacementCandidates: [], timeline: [],
      },
      'POST /placements/pl90/upgrade/cancel': { cancelled: true },
    });
    signInAs('ceo');
    renderScreen(<PlacementDetail />, { portal: 'ceo', path: '/ceo/placements/pl90', route: '/ceo/placements/:id', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel now' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Owner refuses to pay');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel replacement' }));
    await waitFor(() => expect(api.calls('POST /placements/pl90/upgrade/cancel')[0].body).toEqual({ reason: 'Owner refuses to pay' }));
  });
});

describe('Claims paused by a permanent suspension (M10)', () => {
  it('lists them on the claims page', async () => {
    mockApi({
      ...common,
      'GET /ceo/claims': { rows: [], total: 0, page: 1, pageSize: 25, summary: { thisMonth: 0, waitingForDecision: 0, searchesRunning: 0, refundableFromSearchPaise: 0, searchDays: 15 } },
      'GET /placements/claims/suspended-businesses': [
        { claimId: 'c1', claimCode: 'RC-1', pausedSince: '2026-11-20T06:00:00Z', pausedDays: 11, placement: { id: 'pl72', code: 'PL-00072' }, business: { id: 'b1', code: 'BZ-1', name: 'Green Leaf Café', reason: 'Forged licence' } },
      ],
    });
    signInAs('ceo');
    renderScreen(<Claims />, { portal: 'ceo', path: '/ceo/placements/claims', now: NOW });
    const list = await screen.findByTestId('paused-claims');
    expect(within(list).getByText(/Green Leaf Café/)).toBeInTheDocument();
    expect(within(list).getByText(/11 days/)).toBeInTheDocument();
  });
});
