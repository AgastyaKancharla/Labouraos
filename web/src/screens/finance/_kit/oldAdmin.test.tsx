import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import MoneyIn from '../FN-MoneyIn';
import MatchPayment from '../FN-Match';
import Bank from '../FN-Bank';
import Payouts from '../FN-Payouts';
import PaymentsIn from '../../ceo/C-Payments';

/**
 * What only the old Admin Dashboard (/console/admin, retired 14 Nov) used to
 * do, now on the Finance screens: add a bank credit from the statement, set a
 * credit aside, and resolve payment and payout flags.
 */
const NOW = new Date('2026-11-14T06:30:00Z'); // 12:00 IST
const common = { 'GET /finance/counts': { bankCreditsUnmatched: 1, invoicesUnpaid: 0, payoutsDue: 0, expensesToApprove: 0 }, 'GET /refunds/due': [] };

const credit = (over: Record<string, unknown> = {}) => ({
  id: 'c2',
  kind: 'bank_credit',
  at: '2026-11-13T04:28:00Z',
  utr: '431212008877',
  payerName: 'RAVI K',
  payerVpaMasked: 'ra***@okicici',
  remark: null,
  for: null,
  expectedPaise: null,
  receivedPaise: 49900,
  status: 'not_matched',
  shortByPaise: null,
  tds: null,
  returnedUtr: null,
  duplicateRefund: null,
  ...over,
});
const moneyIn = (rows = [credit()]) => ({ rows, summary: { receivedPaise: 49900, receivedCount: rows.length, matchedAutoCount: 0, needYouCount: 1, tdsThisMonthPaise: 0 } });

const flag = (over: Record<string, unknown> = {}) => ({
  id: 'rf1',
  code: 'RF-00011',
  kind: 'payment_mismatch',
  subjectType: 'bank_credit',
  subjectId: 'c2',
  details: { reason: 'amount_mismatch', bankUtr: '431212008877', expectedPaise: 49900 },
  status: 'open',
  raisedAt: '2026-11-13T04:29:00Z',
  raisedForStaff: null,
  ...over,
});

describe('Add from statement (FN-MoneyIn, FN-Bank)', () => {
  it('adds a credit by hand: date and time in IST, amount in paise, UTR, payer and narration', async () => {
    const api = mockApi({ ...common, 'GET /finance/money-in': moneyIn([]), 'GET /payments/review-flags': [], 'POST /payments/bank-credits': { id: 'c9', status: 'unmatched' } });
    signInAs('finance');
    renderScreen(<MoneyIn />, { portal: 'finance', path: '/finance/money-in', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Add from statement' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a credit from the bank statement' });
    const add = within(dialog).getByRole('button', { name: 'Add the credit' });
    expect(add).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText(/Date on the statement/));
    await userEvent.type(within(dialog).getByLabelText(/Date on the statement/), '2026-11-13');
    await userEvent.type(within(dialog).getByLabelText(/Time \(if shown\)/), '09:58');
    await userEvent.type(within(dialog).getByLabelText(/Amount credited/), '8850');
    await userEvent.type(within(dialog).getByLabelText(/UTR \/ reference/), '431299887766');
    await userEvent.type(within(dialog).getByLabelText(/Payer name/), 'HOTEL KAMAT');
    await userEvent.type(within(dialog).getByLabelText(/Narration/), 'LB-PL98');
    await userEvent.click(add);
    await waitFor(() => expect(api.calls('POST /payments/bank-credits')).toHaveLength(1));
    expect(api.calls('POST /payments/bank-credits')[0].body).toEqual({
      bankUtr: '431299887766',
      amountPaise: 885000,
      receivedAt: '2026-11-13T09:58:00+05:30',
      payerName: 'HOTEL KAMAT',
      remark: 'LB-PL98',
    });
    expect(await screen.findByText('₹8,850 added from the statement · UTR 431299887766')).toBeInTheDocument();
  });

  it('refuses the same UTR twice, saying so in the form', async () => {
    mockApi({ ...common, 'GET /finance/money-in': moneyIn([]), 'GET /payments/review-flags': [], 'POST /payments/bank-credits': apiError(409, "Bank credit with UTR '431212008877' already exists") });
    signInAs('finance');
    renderScreen(<MoneyIn />, { portal: 'finance', path: '/finance/money-in', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Add from statement' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Amount credited/), '499');
    await userEvent.type(within(dialog).getByLabelText(/UTR \/ reference/), '431212008877');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add the credit' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('UTR 431212008877 is already in the books');
  });

  it('is on the Bank screen too, where the design assumed an automatic feed', async () => {
    mockApi({
      ...common,
      'GET /finance/bank': {
        lines: [{ id: 'bc-c2', at: '2026-11-13T04:28:00Z', direction: 'credit', amountPaise: 49900, what: 'Unknown payer', status: 'unknown', reference: '431212008877', source: 'bank_credit' }],
        days: [],
        summary: { booksBalancePaise: 0, lastClosedDay: null, lastBankClosingPaise: null, linesToSort: 1 },
      },
    });
    signInAs('finance');
    renderScreen(<Bank />, { portal: 'finance', path: '/finance/bank', now: NOW });
    expect(await screen.findByText('Unknown · find it')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add from statement' }).length).toBeGreaterThan(0);
    // an unknown credit line can be set aside right here
    expect(screen.getByRole('button', { name: 'Set aside' })).toBeInTheDocument();
  });
});

describe('Set a credit aside (not Laboura’s money)', () => {
  it('needs a reason, and sends it to the ignore endpoint', async () => {
    const api = mockApi({ ...common, 'GET /finance/money-in': moneyIn(), 'GET /payments/review-flags': [], 'POST /payments/bank-credits/c2/ignore': { id: 'c2', status: 'ignored' } });
    signInAs('finance');
    renderScreen(<MoneyIn />, { portal: 'finance', path: '/finance/money-in', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Set aside' }));
    const dialog = screen.getByRole('dialog', { name: 'Set ₹499 aside' });
    const confirm = within(dialog).getByRole('button', { name: 'Set it aside' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Why this is not Laboura/), 'Owner rent sent to the wrong account');
    await userEvent.click(confirm);
    await waitFor(() => expect(api.calls('POST /payments/bank-credits/c2/ignore')[0].body).toEqual({ reason: 'Owner rent sent to the wrong account' }));
  });

  it('shows a set-aside credit with its reason', async () => {
    mockApi({ ...common, 'GET /finance/money-in': moneyIn([credit({ status: 'ignored', ignoredReason: 'Personal transfer' })]), 'GET /payments/review-flags': [] });
    signInAs('finance');
    renderScreen(<MoneyIn />, { portal: 'finance', path: '/finance/money-in', now: NOW });
    expect(await screen.findByText('Set aside · Personal transfer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set aside' })).not.toBeInTheDocument();
  });

  it('sits next to "Return the money" on Match a payment', async () => {
    mockApi({
      ...common,
      'GET /finance/bank-credits/c2/matches': {
        credit: { id: 'c2', utr: '431212008877', amountPaise: 49900, at: '2026-11-13T04:28:00Z', payerName: null, payerVpaMasked: 'ra***@okicici', remark: null, status: 'unmatched', returnedUtr: null },
        candidates: [],
      },
    });
    signInAs('finance');
    renderScreen(<MatchPayment />, { portal: 'finance', path: '/finance/money-in/match?credit=c2', now: NOW });
    expect(await screen.findByRole('button', { name: 'Return the money' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set aside' })).toBeInTheDocument();
  });

  it('the CEO can set an unmatched credit aside from Payments, as on the old dashboard', async () => {
    const api = mockApi({
      'GET /ceo/payments/in': {
        rows: [],
        total: 0,
        summary: { receivedInclGstPaise: 0, matched: 0, unmatchedCredits: 1, amountMismatches: 0, duplicatesToRefund: 0 },
        byType: { activationPaise: 0, activationCount: 0, placementFeePaise: 0, placementCount: 0, gstPaise: 0, refundsPaidPaise: 0, netPaise: 0 },
        unmatched: [{ id: 'c2', utr: '431212008877', amountPaise: 49900, at: '2026-11-13T04:28:00Z', payerName: 'RAVI K' }],
        unpaidFees: { withinDue: [], overdue: [] },
      },
      'POST /payments/bank-credits/c2/ignore': { id: 'c2', status: 'ignored' },
    });
    signInAs('ceo');
    renderScreen(<PaymentsIn />, { portal: 'ceo', path: '/ceo/payments', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Set aside' }));
    await userEvent.type(screen.getByLabelText(/Why this is not Laboura/), 'Not ours');
    await userEvent.click(screen.getByRole('button', { name: 'Set it aside' }));
    await waitFor(() => expect(api.calls('POST /payments/bank-credits/c2/ignore')[0].body).toEqual({ reason: 'Not ours' }));
  });
});

describe('Finance resolves payment and payout flags', () => {
  it('Money in lists open payment flags (not payout ones) and resolves one with a written resolution', async () => {
    const api = mockApi({
      ...common,
      'GET /finance/money-in': moneyIn(),
      'GET /payments/review-flags': [flag(), flag({ id: 'rf2', code: 'RF-00012', kind: 'payout_shared_account', subjectType: 'referral', subjectId: 'r14' })],
      'POST /payments/review-flags/rf1/resolve': { id: 'rf1', status: 'resolved' },
    });
    signInAs('finance');
    renderScreen(<MoneyIn />, { portal: 'finance', path: '/finance/money-in', now: NOW });
    const table = await screen.findByRole('table', { name: 'Payment flags to resolve' });
    expect(within(table).getByText('Payment does not match')).toBeInTheDocument();
    expect(within(table).getByText(/bank utr: 431212008877/)).toBeInTheDocument();
    expect(within(table).queryByText(/RF-00012/)).not.toBeInTheDocument();
    expect(api.calls('GET /payments/review-flags')[0].query.get('status')).toBe('open');

    await userEvent.click(within(table).getByRole('button', { name: 'Resolve' }));
    const dialog = screen.getByRole('dialog', { name: 'Resolve RF-00011' });
    expect(within(dialog).getByRole('button', { name: 'Resolve the flag' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/What you found and did/), 'Matched by hand to PAY-00249');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resolve the flag' }));
    await waitFor(() => expect(api.calls('POST /payments/review-flags/rf1/resolve')[0].body).toEqual({ resolution: 'Matched by hand to PAY-00249' }));
  });

  it('Payouts: a flagged payout offers "Resolve flag" for that person, and the payout flags are listed', async () => {
    const row = {
      id: 'p5',
      code: 'PAY-00105',
      type: 'referral_payout',
      to: { kind: 'referral', code: 'RF-00014', name: 'Raju Kumar' },
      owner: { ownerType: 'referral', ownerId: 'r14' },
      placement: null,
      amountPaise: 20000,
      status: 'pending',
      state: 'flagged',
      payableAt: null,
      ceoReason: null,
      account: { method: 'upi', masked: 'ra***@okaxis', status: 'flagged', verifiedName: null, nameMatches: null },
      failureReason: null,
      tds: null,
      createdAt: '2026-11-13T06:00:00Z',
    };
    const api = mockApi({
      ...common,
      'GET /finance/payouts': { rows: [row], summary: { referralDuePaise: 20000, referralDueCount: 1, rewardDuePaise: 0, rewardDueCount: 0, refundsDuePaise: 0, refundsDueCount: 0, failedCount: 0, tdsCount: 0, readyCount: 0, readyPaise: 0, tdsLimitPaise: 2000000, businessRefundLimitPaise: 1500000, financialYear: '2026-27' } },
      'GET /payments/review-flags': [flag(), flag({ id: 'rf2', code: 'RF-00012', kind: 'payout_shared_account', subjectType: 'referral', subjectId: 'r14', details: { payoutAccountCode: 'PA-00031', sharedWithAccountCode: 'PA-00007' } })],
      'POST /payments/review-flags/rf2/resolve': { id: 'rf2', status: 'resolved' },
    });
    signInAs('finance');
    renderScreen(<Payouts />, { portal: 'finance', path: '/finance/payouts', now: NOW });
    expect(await screen.findByText('Details flagged')).toBeInTheDocument();
    const flags = await screen.findByRole('table', { name: 'Payout flags to resolve' });
    expect(within(flags).getByText('Payout account used by someone else too')).toBeInTheDocument();
    expect(within(flags).queryByText('Payment does not match')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send details link' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resolve flag' }));
    await userEvent.type(screen.getByLabelText(/What you found and did/), 'Brothers sharing one account, checked on a call');
    await userEvent.click(screen.getByRole('button', { name: 'Resolve the flag' }));
    await waitFor(() => expect(api.calls('POST /payments/review-flags/rf2/resolve')[0].body).toEqual({ resolution: 'Brothers sharing one account, checked on a call' }));
  });

  it('shows no flags card when nothing is open', async () => {
    mockApi({ ...common, 'GET /finance/money-in': moneyIn(), 'GET /payments/review-flags': [] });
    signInAs('finance');
    renderScreen(<MoneyIn />, { portal: 'finance', path: '/finance/money-in', now: NOW });
    expect(await screen.findByText('Not matched')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Payment flags to resolve' })).not.toBeInTheDocument();
  });
});
