import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import MoneyToday from '../FN-Home';
import Payouts from '../FN-Payouts';
import Expenses from '../FN-Expenses';
import MoneyIn from '../FN-MoneyIn';
import MatchPayment from '../FN-Match';
import Bank from '../FN-Bank';
import Invoices from '../FN-Invoices';
import ApprovalLimits from '../FN-Limits';
import CeoExpenses from '../../ceo/C-Expenses';

const NOW = new Date('2026-11-09T13:30:00Z');
const counts = { bankCreditsUnmatched: 1, invoicesUnpaid: 2, payoutsDue: 3, expensesToApprove: 1 };
const common = { 'GET /finance/counts': counts, 'GET /refunds/due': [] };

const home = {
  stats: { receivedThisMonthPaise: 14823000, paidOutThisMonthPaise: 42757200, booksBalancePaise: 36297300, refundsToPayPaise: 1043800, refundsToPayCount: 3, gstLastMonthPaise: 5616000, gstMonth: '2026-09-30T18:30:00.000Z', gstDue: { gstr1: '2026-11-11', gstr3b: '2026-11-20' } },
  todo: {
    refundsWithinLimit: { count: 3, paise: 1043800 },
    refundsWithCeo: { count: 4, paise: 3707900 },
    paymentsToSort: { count: 4, paise: 1809700 },
    payoutsReady: { count: 5, paise: 120000 },
    payoutsFailed: { count: 0, paise: 0 },
    feesOverdue: { count: 2, paise: 1888000 },
    billsToPay: { count: 2, paise: 4740000 },
    tdsWarnings: 1,
  },
  today: [
    { id: 'bc-1', at: '2026-11-09T06:12:00Z', direction: 'credit', amountPaise: 944000, what: 'Green Leaf Café · INV-00099', status: 'matched', reference: 'UTR1', source: 'bank_credit' },
    { id: 'bc-2', at: '2026-11-09T04:28:00Z', direction: 'credit', amountPaise: 49900, what: 'Unknown payer', status: 'unknown', reference: 'UTR2', source: 'bank_credit' },
    { id: 'pay-3', at: '2026-11-09T04:00:00Z', direction: 'debit', amountPaise: 49900, what: 'Refund · JS-00203', status: 'matched', reference: '431209990011', source: 'payment' },
  ],
  limits: { businessRefundLimitPaise: 1500000, expenseLimitPaise: 1000000, referralTdsYearlyLimitPaise: 2000000 },
};

describe('Money today (FN-Home)', () => {
  it('shows the greeting, the five numbers, the to-do list, money moving and the limits', async () => {
    mockApi({ ...common, 'GET /finance/home': home });
    signInAs('finance');
    renderScreen(<MoneyToday />, { portal: 'finance', path: '/finance', now: NOW });
    expect(await screen.findByText('₹1,48,230')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Good evening, Nisha' })).toBeInTheDocument();
    expect(screen.getByText('₹3,62,973')).toBeInTheDocument();
    expect(screen.getByText('₹56,160')).toBeInTheDocument();
    const todo = screen.getByRole('table', { name: 'To do today' });
    expect(within(todo).getByText('Refunds within your limit')).toBeInTheDocument();
    expect(within(todo).getAllByRole('link', { name: 'Open' }).length).toBe(5);
    expect(screen.getByText(/nothing matches/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Match' })).toBeInTheDocument();
    expect(screen.getByText('You approve up to ₹15,000 · above goes to the CEO')).toBeInTheDocument();
    expect(screen.getByText('Up to ₹10,000 with a bill')).toBeInTheDocument();
    expect(screen.getByText(/4 refunds are with the CEO/)).toBeInTheDocument();
  });

  it('shows the error with a retry', async () => {
    mockApi({ ...common, 'GET /finance/home': apiError(500, 'Internal server error', 'req-fin') });
    signInAs('finance');
    renderScreen(<MoneyToday />, { portal: 'finance', path: '/finance', now: NOW });
    expect(await screen.findByText('Reference: req-fin')).toBeInTheDocument();
  });
});

const payout = (over: Record<string, unknown>) => ({
  id: 'p1',
  code: 'PAY-00101',
  type: 'referral_payout',
  to: { kind: 'referral', code: 'RF-00014', name: 'Raju Kumar' },
  owner: { ownerType: 'referral', ownerId: 'r14' },
  placement: { id: 'pl1', code: 'PL-00071', workerName: 'Arjun' },
  amountPaise: 20000,
  status: 'pending',
  state: 'ready',
  payableAt: null,
  ceoReason: null,
  account: { method: 'upi', masked: 'ra***@okaxis', status: 'verified', verifiedName: 'Raju Kumar', nameMatches: true },
  failureReason: null,
  tds: null,
  createdAt: '2026-11-08T06:00:00Z',
  ...over,
});
const payoutsResponse = {
  rows: [
    payout({}),
    payout({ id: 'p2', code: 'PAY-00102', to: { kind: 'referral', code: 'RF-00026', name: 'Naveen S' }, state: 'waiting_48h', payableAt: '2026-11-11T05:30:00Z' }),
    payout({ id: 'p3', code: 'PAY-00103', type: 'joining_reward', to: { kind: 'job_seeker', code: 'JS-00160', name: 'Meena J' }, owner: { ownerType: 'job_seeker', ownerId: 'js160' }, status: 'failed', state: 'failed', failureReason: 'account closed' }),
    payout({ id: 'p4', code: 'PAY-00104', to: { kind: 'referral', code: 'RF-00031', name: 'Sri Krishna Agencies' }, amountPaise: 40000, tds: { paidThisYearPaise: 1980000, afterPaise: 2020000, limitPaise: 2000000, alreadyOver: false } }),
  ],
  summary: { referralDuePaise: 120000, referralDueCount: 5, rewardDuePaise: 60000, rewardDueCount: 3, refundsDuePaise: 0, refundsDueCount: 0, failedCount: 2, tdsCount: 1, readyCount: 2, readyPaise: 60000, tdsLimitPaise: 2000000, businessRefundLimitPaise: 1500000, financialYear: '2026-27' },
};

describe('Payouts (FN-Payouts)', () => {
  it('lists each payout with whether it can be paid today and pays one with its UTR', async () => {
    const api = mockApi({ ...common, 'GET /finance/payouts': payoutsResponse, 'POST /finance/payouts/p1/pay': { id: 'p1', status: 'succeeded' } });
    signInAs('finance');
    renderScreen(<Payouts />, { portal: 'finance', path: '/finance/payouts', now: NOW });
    expect(await screen.findByText('Raju Kumar · RF-00014')).toBeInTheDocument();
    expect(screen.getByText('₹1,200')).toBeInTheDocument();
    expect(screen.getByText('Details changed · waiting 48 h')).toBeInTheDocument();
    expect(screen.getByText('Failed · account closed')).toBeInTheDocument();
    expect(screen.getByText('TDS limit crossed with this one')).toBeInTheDocument();
    expect(screen.getByText('₹19,800 this year → over ₹20,000')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Pay and record' })[0]);
    await userEvent.type(screen.getByLabelText(/UTR from the bank/), '431212008877');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.calls('POST /finance/payouts/p1/pay')).toHaveLength(1));
    expect(api.calls('POST /finance/payouts/p1/pay')[0].body).toEqual({ utr: '431212008877', receiverNameShown: 'Raju Kumar' });
    expect(await screen.findByText('PAY-00101 paid and recorded')).toBeInTheDocument();
  });

  it('retries a failed payout and sends the filters', async () => {
    const api = mockApi({ ...common, 'GET /finance/payouts': payoutsResponse, 'POST /finance/payouts/p3/retry': { id: 'p3', status: 'approved' } });
    signInAs('finance');
    renderScreen(<Payouts />, { portal: 'finance', path: '/finance/payouts?status=failed', now: NOW });
    expect(await screen.findByText('Meena J · PL-00071')).toBeInTheDocument();
    expect(api.calls('GET /finance/payouts')[0].query.get('status')).toBe('failed');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await userEvent.click(screen.getByRole('button', { name: 'Retry this payout' }));
    await waitFor(() => expect(api.calls('POST /finance/payouts/p3/retry')).toHaveLength(1));
    await userEvent.selectOptions(screen.getByLabelText('Who'), 'job_seeker');
    await waitFor(() => expect(api.calls('GET /finance/payouts').at(-1)!.query.get('who')).toBe('job_seeker'));
  });

  it('pays all ready payouts, each with its own UTR', async () => {
    const api = mockApi({ ...common, 'GET /finance/payouts': payoutsResponse, 'POST /finance/payouts/pay-all': { paid: 1, failed: 0, results: [{ id: 'p1', ok: true }] } });
    signInAs('finance');
    renderScreen(<Payouts />, { portal: 'finance', path: '/finance/payouts', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Pay all ready (₹600)' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getAllByLabelText('UTR')[0], '111122223333');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record 1 payment' }));
    await waitFor(() => expect(api.calls('POST /finance/payouts/pay-all')).toHaveLength(1));
    expect(api.calls('POST /finance/payouts/pay-all')[0].body).toEqual({ items: [{ id: 'p1', utr: '111122223333', receiverNameShown: 'Raju Kumar' }] });
  });

  it('shows the empty state', async () => {
    mockApi({ ...common, 'GET /finance/payouts': { ...payoutsResponse, rows: [] } });
    signInAs('finance');
    renderScreen(<Payouts />, { portal: 'finance', path: '/finance/payouts', now: NOW });
    expect(await screen.findByText('No rows match these filters. Change a filter to see more.')).toBeInTheDocument();
  });
});

const expense = (over: Record<string, unknown>) => ({
  id: 'e1',
  code: 'EXP-00001',
  kind: 'manual',
  category: 'field_travel',
  supplier: 'Kiran Kumar',
  description: 'petrol, 22 visits',
  adChannel: null,
  amountPaise: 240000,
  gstPaise: 0,
  billDate: '2026-10-27T00:00:00Z',
  paidFrom: null,
  hasBill: true,
  status: 'waiting_finance',
  needsCeo: false,
  withinFinanceLimit: true,
  enteredBy: { name: 'Nisha Rao', role: 'finance' },
  approvedBy: null,
  rejectedBy: null,
  rejectionReason: null,
  paidAt: null,
  paymentReference: null,
  ...over,
});
const expensesResponse = {
  rows: [
    expense({}),
    expense({ id: 'e2', code: 'EXP-00002', category: 'calling', supplier: 'Exotel', description: 'October bill', amountPaise: 1840000, status: 'paid', needsCeo: true, approvedBy: { name: 'Agastya', role: 'ceo' } }),
    expense({ id: 'e3', code: 'EXP-00003', category: 'rent', supplier: 'JP Nagar', description: 'November rent', amountPaise: 4500000, status: 'waiting_ceo', needsCeo: true }),
    expense({ id: 'e4', code: 'EXP-00004', category: 'office_other', supplier: 'Shop', description: 'Printer cartridge', amountPaise: 180000, hasBill: false }),
  ],
  auto: [{ id: 'a1', code: 'PAY-1', category: 'payouts_rewards', what: 'Referral payout · RF-1', amountPaise: 20000, paidAt: '2026-11-02T00:00:00Z' }],
  refundsAgainstRevenue: { count: 1, paise: 49900 },
  summary: { spentPaise: 2080000, billsPaise: 2060000, autoPaise: 20000, budgetPaise: 5455000, toPayCount: 3, dueNowPaise: 420000, waitingCeoCount: 1, waitingCeoPaise: 4500000, limitPaise: 1000000 },
};

describe('Expenses & bills (FN-Expenses)', () => {
  it('shows every bill with its approval and approves-and-pays one within the limit', async () => {
    const api = mockApi({ ...common, 'GET /finance/expenses': expensesResponse, 'POST /finance/expenses/e1/approve': expense({ status: 'paid' }) });
    signInAs('finance');
    renderScreen(<Expenses />, { portal: 'finance', path: '/finance/expenses', now: NOW });
    expect((await screen.findAllByText('To approve · within your limit')).length).toBe(2);
    expect(screen.getByText('Approved by CEO (over ₹10,000) · Paid')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the CEO (over ₹10,000)')).toBeInTheDocument();
    expect(screen.getByText('Over ₹10,000 · the CEO approves')).toBeInTheDocument();
    expect(screen.getByText('Attach bill')).toBeInTheDocument();
    expect(screen.getByText('₹20,800')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Approve and pay' })[0]);
    await userEvent.type(screen.getByLabelText(/^Reference/), 'UPI99');
    await userEvent.click(screen.getByRole('button', { name: 'Approve and record' }));
    await waitFor(() => expect(api.calls('POST /finance/expenses/e1/approve')).toHaveLength(1));
    expect(api.calls('POST /finance/expenses/e1/approve')[0].body).toEqual({ pay: { paidFrom: 'bank_transfer', reference: 'UPI99' } });
  });

  it('cannot approve a bill-less expense, and adds a bill with the file', async () => {
    const api = mockApi({ ...common, 'GET /finance/expenses': expensesResponse, 'POST /finance/expenses': expense({ id: 'e9', code: 'EXP-00009' }) });
    signInAs('finance');
    renderScreen(<Expenses />, { portal: 'finance', path: '/finance/expenses', now: NOW });
    await screen.findByText('Printer cartridge', { exact: false });
    const buttons = screen.getAllByRole('button', { name: 'Approve and pay' });
    expect(buttons.at(-1)).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^Supplier/), 'Exotel');
    await userEvent.type(screen.getByLabelText(/^What/), 'November bill');
    await userEvent.type(screen.getByLabelText(/^Amount/), '2400');
    await userEvent.upload(screen.getByLabelText('Bill'), new File(['%PDF'], 'bill.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }));
    await waitFor(() => expect(api.calls('POST /finance/expenses')).toHaveLength(1));
    expect(await screen.findByText('EXP-00009 added · approve and pay it when ready')).toBeInTheDocument();
  });

  it('shows the error with a retry', async () => {
    mockApi({ ...common, 'GET /finance/expenses': apiError(500, 'Internal server error', 'req-exp') });
    signInAs('finance');
    renderScreen(<Expenses />, { portal: 'finance', path: '/finance/expenses', now: NOW });
    expect(await screen.findByText('Reference: req-exp')).toBeInTheDocument();
  });
});

const credit = (over: Record<string, unknown>) => ({
  id: 'c1',
  kind: 'bank_credit',
  at: '2026-11-09T04:50:00Z',
  utr: '431212008800',
  payerName: 'Hotel Kamat',
  payerVpaMasked: null,
  remark: 'LB-PL98',
  for: { paymentId: 'pay98', paymentCode: 'PAY-00098', type: 'placement_fee', invoiceCode: null, placementCode: 'PL-00098', who: { code: 'BZ-00012', name: 'Hotel Kamat' } },
  expectedPaise: 885000,
  receivedPaise: 810000,
  status: 'less',
  shortByPaise: 75000,
  tds: null,
  returnedUtr: null,
  duplicateRefund: null,
  ...over,
});

describe('Money in (FN-MoneyIn) and Match a payment (FN-Match)', () => {
  it('records a short placement fee as TDS and returns unclaimed money', async () => {
    const api = mockApi({
      ...common,
      'GET /finance/money-in': {
        rows: [credit({}), credit({ id: 'c2', for: null, payerName: null, payerVpaMasked: 'ra***@okicici', remark: null, expectedPaise: null, receivedPaise: 49900, status: 'not_matched', shortByPaise: null })],
        summary: { receivedPaise: 859900, receivedCount: 2, matchedAutoCount: 0, needYouCount: 2, tdsThisMonthPaise: 0 },
      },
      'POST /payments/pay98/confirm': { success: true },
      'POST /finance/bank-credits/c2/return': { id: 'c2', status: 'returned' },
    });
    signInAs('finance');
    renderScreen(<MoneyIn />, { portal: 'finance', path: '/finance/money-in', now: NOW });
    expect(await screen.findByText('₹750 less · TDS by the business?')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Money in' })).getByText('Not matched')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Match' })).toHaveAttribute('href', '/finance/money-in/match?credit=c2');

    await userEvent.click(screen.getByRole('button', { name: 'Record as TDS' }));
    await userEvent.type(screen.getByLabelText(/TDS section/), '194J');
    await userEvent.click(screen.getByRole('button', { name: /Record ₹750 as TDS deducted/ }));
    await waitFor(() => expect(api.calls('POST /payments/pay98/confirm')).toHaveLength(1));
    expect(api.calls('POST /payments/pay98/confirm')[0].body).toEqual({ bankCreditId: 'c1', tdsDeductedPaise: 75000, tdsNote: '194J' });

    await userEvent.click(screen.getByRole('button', { name: 'Return the money' }));
    await userEvent.type(screen.getByLabelText(/UTR of the money sent back/), '9988');
    await userEvent.click(screen.getByRole('button', { name: 'Record the return' }));
    await waitFor(() => expect(api.calls('POST /finance/bank-credits/c2/return')[0].body).toEqual({ utr: '9988' }));
  });

  it('offers the possible matches and matches one', async () => {
    const api = mockApi({
      ...common,
      'GET /finance/bank-credits/c2/matches': {
        credit: { id: 'c2', utr: '431212008877', amountPaise: 49900, at: '2026-11-09T04:28:00Z', payerName: 'RAVI K', payerVpaMasked: 'ra***@okicici', remark: null, status: 'unmatched', returnedUtr: null },
        candidates: [{ paymentId: 'pj249', paymentCode: 'PAY-00249', type: 'activation', who: { code: 'JS-00249', name: 'Ravi Kumar' }, invoiceCode: null, placementCode: null, linkSentAt: '2026-11-09T04:11:00Z', expectedPaise: 49900, reference: 'LB-JS249', score: 85, reasons: ['Same amount', 'Same first name', '17 min after the link was sent'], shortByPaise: 0 }],
      },
      'POST /payments/pj249/confirm': { success: true },
    });
    signInAs('finance');
    renderScreen(<MatchPayment />, { portal: 'finance', path: '/finance/money-in/match?credit=c2', now: NOW });
    expect(await screen.findByText('JS-00249 · Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Same amount · Same first name · 17 min after the link was sent')).toBeInTheDocument();
    expect(screen.getByText(/no reference in the note/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Match to this' }));
    await userEvent.click(screen.getByRole('button', { name: 'Match to JS-00249 · Ravi Kumar' }));
    await waitFor(() => expect(api.calls('POST /payments/pj249/confirm')[0].body).toEqual({ bankCreditId: 'c2' }));
  });
});

describe('Bank (FN-Bank)', () => {
  it('shows the lines and the days, and closes a day with the statement balance', async () => {
    const api = mockApi({
      ...common,
      'GET /finance/bank': {
        lines: [
          { id: 'bc-1', at: '2026-11-08T06:12:00Z', direction: 'credit', amountPaise: 944000, what: 'Green Leaf Café · INV-00099', status: 'matched', reference: 'U1', source: 'bank_credit' },
          { id: 'pay-1', at: '2026-11-08T04:00:00Z', direction: 'debit', amountPaise: 49900, what: 'Refund · JS-00203', status: 'matched', reference: '431209990011', source: 'payment' },
        ],
        days: [{ day: '2026-11-08', openingPaise: 36415300, inPaise: 944000, outPaise: 49900, booksClosingPaise: 37309400, bankClosingPaise: null, differencePaise: null, unmatched: 0, closed: null }],
        summary: { booksBalancePaise: 37309400, lastClosedDay: '2026-11-07', lastBankClosingPaise: 36415300, linesToSort: 0 },
      },
      'POST /finance/bank/close-day': { day: '2026-11-08' },
    });
    signInAs('finance');
    renderScreen(<Bank />, { portal: 'finance', path: '/finance/bank', now: NOW });
    expect(await screen.findByText('Matched · UTR 431209990011')).toBeInTheDocument();
    expect(screen.getAllByText('₹3,73,094').length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole('button', { name: 'Close 8 Nov' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Close the day' }));
    await waitFor(() => expect(api.calls('POST /finance/bank/close-day')[0].body).toEqual({ day: '2026-11-08', bankClosingPaise: 37309400 }));
  });
});

describe('Invoices (FN-Invoices)', () => {
  it('lists invoices, receipts and unpaid fees with their actions', async () => {
    const api = mockApi({
      ...common,
      'GET /finance/invoices': {
        rows: [
          { id: 'pl98', kind: 'invoice', number: 'INV-00098', to: { code: 'BZ-1', name: 'Hotel Kamat' }, forWhat: { type: 'placement_fee', placementCode: 'PL-00098', placementId: 'pl98' }, feePaise: 750000, gstPaise: 135000, totalPaise: 885000, date: '2026-11-09T04:50:00Z', status: 'tds_due', waitingDays: null, tds: { id: 't1', amountPaise: 75000, status: 'certificate_due', note: '194J' }, shortByPaise: null, paymentId: 'p98', downloadPath: '/placements/pl98/invoice/copy?token=x' },
          { id: 'pl97', kind: 'invoice', number: null, to: { code: 'BZ-2', name: 'Udupi Grand' }, forWhat: { type: 'placement_fee', placementCode: 'PL-00097', placementId: 'pl97' }, feePaise: 800000, gstPaise: 144000, totalPaise: 944000, date: '2026-11-04T04:50:00Z', status: 'overdue', waitingDays: 5, tds: null, shortByPaise: null, paymentId: 'p97', downloadPath: null },
          { id: 'p252', kind: 'receipt', number: 'PAY-00252', to: { code: 'JS-00252', name: 'Lokesh R' }, forWhat: { type: 'activation', placementCode: null, placementId: null }, feePaise: 49900, gstPaise: 0, totalPaise: 49900, date: '2026-11-09T05:35:00Z', status: 'receipt', waitingDays: null, tds: null, shortByPaise: null, paymentId: 'p252', downloadPath: '/payments/p252/receipt?token=y' },
        ],
        summary: { invoiceCount: 1, invoicedPaise: 885000, overdueCount: 1, unpaidCount: 1, unpaidPaise: 944000, receiptCount: 1 },
      },
      'POST /finance/tds-receivables/t1/certificate-received': { id: 't1' },
      'POST /payments/p97/resend': { paymentId: 'p97' },
    });
    signInAs('finance');
    renderScreen(<Invoices />, { portal: 'finance', path: '/finance/invoices', now: NOW });
    expect(await screen.findByText('₹750 TDS · certificate due')).toBeInTheDocument();
    expect(screen.getByText('Unpaid · 5 days')).toBeInTheDocument();
    expect(screen.getByText('Receipt sent')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open invoice' })).toHaveAttribute('href', '/placements/pl98/invoice/copy?token=x');
    await userEvent.click(screen.getByRole('button', { name: 'Mark certificate received' }));
    await userEvent.click(screen.getByRole('button', { name: 'TDS certificate received' }));
    await waitFor(() => expect(api.calls('POST /finance/tds-receivables/t1/certificate-received')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send the payment link again' }));
    await waitFor(() => expect(api.calls('POST /payments/p97/resend')).toHaveLength(1));
  });
});

describe('Approval limits (FN-Limits)', () => {
  it('Finance sees the limits but cannot save them', async () => {
    mockApi({ ...common, 'GET /pricing/approval-limits': { businessRefundLimitPaise: 1500000, expenseLimitPaise: 1000000 } });
    signInAs('finance');
    renderScreen(<ApprovalLimits />, { portal: 'finance', path: '/finance/limits', now: NOW });
    expect(await screen.findByText('Up to ₹15,000')).toBeInTheDocument();
    expect(screen.getByText('Up to ₹10,000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save limits' })).toBeNull();
  });

  it('the CEO saves new limits', async () => {
    const api = mockApi({ ...common, 'GET /pricing/approval-limits': { businessRefundLimitPaise: 1500000, expenseLimitPaise: 1000000 }, 'PUT /pricing/approval-limits': {} });
    signInAs('ceo');
    renderScreen(<ApprovalLimits />, { portal: 'finance', path: '/finance/limits', now: NOW });
    const save = await screen.findByRole('button', { name: 'Save limits' });
    await waitFor(() => expect(screen.getByDisplayValue('15,000')).toBeInTheDocument());
    await userEvent.click(save);
    await waitFor(() => expect(api.calls('PUT /pricing/approval-limits')[0].body).toEqual({ businessRefundLimitPaise: 1500000, expenseLimitPaise: 1000000 }));
  });
});

describe('CEO Expenses (C-Expenses)', () => {
  it('shows the profit or loss, budget vs actual, spend per channel and approves an expense above the limit', async () => {
    const api = mockApi({
      'GET /login-codes/pending': [],
      'GET /review-flags': [],
      'GET /refunds/due': [],
      'GET /finance/profit': {
        period: { from: '2026-09-30T18:30:00Z', to: '2026-10-31T18:29:59Z', month: '2026-10' },
        revenue: { activationPaise: 15968000, activationCount: 320, placementFeePaise: 32000000, placementCount: 40, refundsPaise: 1193500, refundsCount: 3, netRevenuePaise: 46774500, gstCollectedPaise: 5760000 },
        expenses: { billsPaise: 12871000, payoutsPaise: 300000, salariesPaise: 0, salariesFromPayroll: false, totalPaise: 13171000 },
        profitPaise: 33603500,
        costPerPlacementPaise: 329275,
        breakEvenPlacements: 17,
        placements: 40,
        categories: [
          { category: 'salaries', added: 'auto', budgetPaise: 42000000, actualPaise: 0 },
          { category: 'calling', added: 'bill', budgetPaise: 1500000, actualPaise: 1840000 },
          { category: 'payouts_rewards', added: 'auto', budgetPaise: 400000, actualPaise: 300000 },
        ],
        budgetTotalPaise: 43900000,
        channels: [
          { channel: 'ad', spentPaise: 1800000, placed: 2, perPlacementPaise: 900000 },
          { channel: 'referral_partner', spentPaise: 300000, placed: 9, perPlacementPaise: 33300 },
        ],
        limitPaise: 1000000,
      },
      'GET /finance/expenses': expensesResponse,
      'POST /finance/expenses/e3/approve': expense({ id: 'e3', status: 'approved' }),
      'PUT /finance/expense-budgets': [],
    });
    signInAs('ceo');
    renderScreen(<CeoExpenses />, { portal: 'ceo', path: '/ceo/expenses', now: NOW });
    expect((await screen.findAllByText('₹4,67,745')).length).toBeGreaterThan(0);
    expect(screen.getByText('+₹3,400 over')).toBeInTheDocument();
    expect(screen.getByText('₹1,000 under')).toBeInTheDocument();
    expect(screen.getByText('Ads / posters cost ₹9,000 per placement; Referral partners ₹333.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve ₹45,000' }));
    await waitFor(() => expect(api.calls('POST /finance/expenses/e3/approve')).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'Set budgets' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save budgets' }));
    await waitFor(() => expect(api.calls('PUT /finance/expense-budgets')[0].body).toMatchObject({ month: '2026-10', budgets: { salaries: 42000000, calling: 1500000 } }));
  });
});
