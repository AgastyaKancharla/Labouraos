import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import MoneyIn from '../FN-MoneyIn';
import MatchPayment from '../FN-Match';
import Bank from '../FN-Bank';
import Payouts from '../FN-Payouts';
import PaymentsIn from '../../ceo/C-Payments';
import MonthEnd from '../FN-Review';

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

  it('says when the credit matched by its reference, and warns when its bank day was already closed', async () => {
    mockApi({ ...common, 'GET /finance/money-in': moneyIn([]), 'GET /payments/review-flags': [], 'POST /payments/bank-credits': { id: 'c9', status: 'matched', match: { status: 'succeeded', paymentId: 'p1' }, closedDay: '2026-11-13' } });
    signInAs('finance');
    renderScreen(<MoneyIn />, { portal: 'finance', path: '/finance/money-in', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Add from statement' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Amount credited/), '499');
    await userEvent.type(within(dialog).getByLabelText(/UTR \/ reference/), '4312 99 88');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add the credit' }));
    expect(await screen.findByText('₹499 added from the statement · UTR 43129988 · matched by its reference')).toBeInTheDocument();
    expect(screen.getByText(/2026-11-13 was already closed with the statement's balance/)).toBeInTheDocument();
  });

  it('Bank marks a closed day whose books changed after closing', async () => {
    mockApi({
      ...common,
      'GET /finance/bank': {
        lines: [],
        days: [{ day: '2026-11-13', openingPaise: 0, inPaise: 49900, outPaise: 0, booksClosingPaise: 49900, bankClosingPaise: 0, differencePaise: 0, unmatched: 0, closed: { bankClosingPaise: 0, differencePaise: 0, note: null, closedBy: 'Nisha', closedAt: '2026-11-13T15:00:00Z', stale: true, differenceNowPaise: -49900 } }],
        summary: { booksBalancePaise: 49900, lastClosedDay: '2026-11-13', lastBankClosingPaise: 0, linesToSort: 0, staleClosedDays: ['2026-11-13'] },
      },
    });
    signInAs('finance');
    renderScreen(<Bank />, { portal: 'finance', path: '/finance/bank', now: NOW });
    expect(await screen.findByText('Changed after closing')).toBeInTheDocument();
    expect(screen.getByText(/A line was added after the day was closed · difference now/)).toBeInTheDocument();
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

  it('shows a set-aside credit with its reason, and the set-aside total apart from money received', async () => {
    const res = moneyIn([credit({ status: 'ignored', ignoredReason: 'Personal transfer' })]);
    mockApi({ ...common, 'GET /finance/money-in': { ...res, summary: { ...res.summary, receivedPaise: 0, receivedCount: 0, setAsidePaise: 49900, setAsideCount: 1 } }, 'GET /payments/review-flags': [] });
    signInAs('finance');
    renderScreen(<MoneyIn />, { portal: 'finance', path: '/finance/money-in', now: NOW });
    expect(await screen.findByText('Set aside · Personal transfer')).toBeInTheDocument();
    expect(screen.getByText(/Set aside, not ours:/)).toHaveTextContent("Set aside, not ours: ₹499 in 1 credit — in the bank but not Laboura's money, so not counted as received.");
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

  it('the CEO sees what was set aside on Payments and can undo it with a reason', async () => {
    const api = mockApi({
      'GET /ceo/payments/in': {
        rows: [], total: 0,
        summary: { receivedInclGstPaise: 0, matched: 0, unmatchedCredits: 0, amountMismatches: 0, duplicatesToRefund: 0 },
        byType: { activationPaise: 0, activationCount: 0, placementFeePaise: 0, placementCount: 0, gstPaise: 0, refundsPaidPaise: 0, netPaise: 0 },
        unmatched: [],
        setAside: [{ id: 'c7', utr: 'U7', amountPaise: 49900, at: '2026-11-12T04:00:00Z', payerName: 'RAVI K', reason: 'Personal transfer', setAsideAt: '2026-11-12T06:00:00Z', setAsideBy: 'Nisha Rao' }],
        unpaidFees: { withinDue: [], overdue: [] },
      },
      'POST /payments/bank-credits/c7/undo-set-aside': { id: 'c7', status: 'unmatched' },
    });
    signInAs('ceo');
    renderScreen(<PaymentsIn />, { portal: 'ceo', path: '/ceo/payments', now: NOW });
    expect(await screen.findByText(/“Personal transfer” · set aside by Nisha Rao/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo set-aside' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Undo set-aside' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Why it is undone/), 'It was a placement fee');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Undo set-aside' }));
    await waitFor(() => expect(api.calls('POST /payments/bank-credits/c7/undo-set-aside')[0].body).toEqual({ reason: 'It was a placement fee' }));
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
      'POST /payments/review-flags/rf2/resolve': { id: 'rf2', status: 'dismissed', outcome: 'genuine', payoutDetailsReleased: 1 },
    });
    signInAs('finance');
    renderScreen(<Payouts />, { portal: 'finance', path: '/finance/payouts', now: NOW });
    expect(await screen.findByText('Details flagged')).toBeInTheDocument();
    const flags = await screen.findByRole('table', { name: 'Payout flags to resolve' });
    expect(within(flags).getByText('Payout account used by someone else too')).toBeInTheDocument();
    expect(within(flags).queryByText('Payment does not match')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send on WhatsApp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send by SMS' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resolve flag' }));
    const dialog = screen.getByRole('dialog', { name: 'Resolve RF-00012' });
    await userEvent.type(within(dialog).getByLabelText(/What you found and did/), 'Brothers sharing one account, checked on a call');
    // both outcomes offered, neither chosen for you
    const confirm = within(dialog).getByRole('button', { name: 'Resolve the flag' });
    expect(confirm).toBeDisabled();
    const outcome = within(dialog).getByRole('combobox', { name: /What you found/ });
    expect(within(outcome).getByRole('option', { name: /Checked, genuine/ })).toBeInTheDocument();
    expect(within(outcome).getByRole('option', { name: /Fraud confirmed/ })).toBeInTheDocument();
    await userEvent.selectOptions(outcome, 'genuine');
    await userEvent.click(confirm);
    await waitFor(() => expect(api.calls('POST /payments/review-flags/rf2/resolve')[0].body).toEqual({ resolution: 'Brothers sharing one account, checked on a call', outcome: 'genuine' }));
    expect(await screen.findByText('RF-00012 closed · payout details released (48-hour wait applies)')).toBeInTheDocument();
  });

  it('Payouts: a person with two open flags shows both, each resolved on its own (fraud keeps them blocked)', async () => {
    const row = {
      id: 'p6', code: 'PAY-00106', type: 'referral_payout', to: { kind: 'referral', code: 'RF-00014', name: 'Raju Kumar' }, owner: { ownerType: 'referral', ownerId: 'r14' },
      placement: null, amountPaise: 20000, status: 'pending', state: 'flagged', payableAt: null, ceoReason: null,
      account: { method: 'upi', masked: 'ra***@okaxis', status: 'flagged', verifiedName: null, nameMatches: null }, failureReason: null, tds: null, createdAt: '2026-11-13T06:00:00Z',
    };
    const api = mockApi({
      ...common,
      'GET /finance/payouts': { rows: [row], summary: { referralDuePaise: 0, referralDueCount: 0, rewardDuePaise: 0, rewardDueCount: 0, refundsDuePaise: 0, refundsDueCount: 0, failedCount: 0, tdsCount: 0, readyCount: 0, readyPaise: 0, tdsLimitPaise: 2000000, businessRefundLimitPaise: 1500000, financialYear: '2026-27' } },
      'GET /payments/review-flags': [
        flag({ id: 'rf2', code: 'RF-00012', kind: 'payout_shared_account', subjectType: 'referral', subjectId: 'r14' }),
        flag({ id: 'rf3', code: 'RF-00013', kind: 'payout_matches_staff', subjectType: 'referral', subjectId: 'r14' }),
      ],
      'POST /payments/review-flags/rf3/resolve': { id: 'rf3', status: 'resolved', outcome: 'fraud', payoutDetailsReleased: 0 },
    });
    signInAs('finance');
    renderScreen(<Payouts />, { portal: 'finance', path: '/finance/payouts', now: NOW });
    expect(await screen.findByRole('button', { name: 'Resolve RF-00012' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resolve RF-00013' }));
    const dialog = screen.getByRole('dialog', { name: 'Resolve RF-00013' });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: /What you found/ }), 'fraud');
    await userEvent.type(within(dialog).getByLabelText(/What you found and did/), 'Agent used his own number');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resolve the flag' }));
    await waitFor(() => expect(api.calls('POST /payments/review-flags/rf3/resolve')[0].body).toEqual({ resolution: 'Agent used his own number', outcome: 'fraud' }));
    expect(await screen.findByText('RF-00013 resolved as fraud · details stay blocked')).toBeInTheDocument();
  });

  it('shows no flags card when nothing is open', async () => {
    mockApi({ ...common, 'GET /finance/money-in': moneyIn(), 'GET /payments/review-flags': [] });
    signInAs('finance');
    renderScreen(<MoneyIn />, { portal: 'finance', path: '/finance/money-in', now: NOW });
    expect(await screen.findByText('Not matched')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Payment flags to resolve' })).not.toBeInTheDocument();
  });
});

describe('Month-end review lists every set-aside; only the CEO can undo one', () => {
  const setAsideAction = { id: 'bank_credit:c7', subjectType: 'bank_credit', subjectId: 'c7', at: '2026-11-12T06:00:00Z', doneBy: { id: 'f1', name: 'Nisha Rao', role: 'finance' }, approvedByCeo: false, type: 'set_aside', what: "Credit set aside (not Laboura's money)", record: 'Credit U7 · RAVI K', amountPaise: 49900, proof: 'Why: Personal transfer', mark: null };
  const review = {
    month: '2026-11', label: 'November 2026', status: 'open', canClose: false, allChecked: true, close: null, checklist: [],
    summary: { actions: 1, byFinanceWithinLimits: 1, approvedByCeo: 0, flagged: 0, moneyOutPaise: 0 }, actions: [setAsideAction], nextMonth: '2026-12',
  };

  it('the CEO sees who set it aside, when and why, and can undo it', async () => {
    const api = mockApi({ ...common, 'GET /finance/month-end': review, 'POST /payments/bank-credits/c7/undo-set-aside': { id: 'c7', status: 'unmatched' } });
    signInAs('ceo');
    renderScreen(<MonthEnd />, { portal: 'ceo', path: '/ceo/month-end?month=2026-11', now: NOW });
    expect(await screen.findByText("Credit set aside (not Laboura's money)")).toBeInTheDocument();
    expect(screen.getByText('Why: Personal transfer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo set-aside' }));
    await userEvent.type(screen.getByLabelText(/Why it is undone/), 'Owner confirmed it was the fee');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo set-aside' }));
    await waitFor(() => expect(api.calls('POST /payments/bank-credits/c7/undo-set-aside')[0].body).toEqual({ reason: 'Owner confirmed it was the fee' }));
  });

  it('Finance sees it too, but cannot undo', async () => {
    mockApi({ ...common, 'GET /finance/month-end': review });
    signInAs('finance');
    renderScreen(<MonthEnd />, { portal: 'finance', path: '/finance/review?month=2026-11', now: NOW });
    expect(await screen.findByText("Credit set aside (not Laboura's money)")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo set-aside' })).not.toBeInTheDocument();
  });
});
