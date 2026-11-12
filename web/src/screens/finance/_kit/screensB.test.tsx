import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import Salaries from '../FN-Salaries';
import TaxPage from '../FN-Tax';
import Reports from '../FN-Reports';
import MonthEndReview from '../FN-Review';
import Refunds from '../FN-Refunds';
import RefundDetail from '../FN-Refund';
import FinanceNotifications from '../FN-Notifications';
import CreditNotes from '../FN-CreditNotes';
import CeoSalaries from '../../ceo/C-Team-Salaries';
import MyPayslips from '../../call-agent/CA14g-Payslip';

const NOW = new Date('2026-11-11T06:30:00Z'); // 12:00 IST
const common = { 'GET /finance/counts': { bankCreditsUnmatched: 0, invoicesUnpaid: 0, payoutsDue: 0, expensesToApprove: 0 }, 'GET /refunds/due': [] };

const row = (over: Record<string, unknown> = {}) => ({
  staffId: 's1',
  staffCode: 'CA-0007',
  name: 'Deepa Nair',
  role: 'call_agent',
  joinedOn: '2026-08-01',
  monthlyPaise: 1800000,
  salaryDays: 26,
  calendarDays: 31,
  workingDays: 26,
  holidays: 1,
  fullDays: 24,
  halfDays: 0,
  paidLeaveDays: 1,
  unpaidLeaveDays: 0,
  absentDays: 1,
  notEmployedDays: 0,
  unmarkedDays: 0,
  paidDays: 25,
  lossOfPayDays: 1,
  shortfallMinutes: 30,
  basicPaise: 900000,
  hraPaise: 360000,
  specialPaise: 540000,
  grossPaise: 1800000,
  notEmployedPaise: 0,
  lossOfPayPaise: 69231,
  shortfallPaise: 4327,
  pfPaise: 0,
  esiPaise: 0,
  professionalTaxPaise: 0,
  deductionsPaise: 73558,
  correctionPaise: 0,
  correctionNote: null,
  netPaise: 1726442,
  line: null,
  ...over,
});

const sheet = (over: Record<string, unknown> = {}) => ({
  month: '2026-10',
  label: 'October 2026',
  status: 'draft',
  closed: false,
  salaryDays: 26,
  calendarDays: 31,
  prepareFrom: '2026-11-01',
  canPrepare: true,
  payDay: '2026-11-01',
  run: null,
  totals: { people: 1, grossPaise: 1800000, deductionsPaise: 73558, lossOfPayAndShortfallPaise: 73558, correctionsPaise: 0, netPaise: 1726442, paidCount: 0, paidPaise: 0, unpaidCount: 1 },
  missingSalary: [],
  openDays: [],
  statutory: { lines: [], note: 'Added after company registration' },
  rows: [row()],
  ...over,
});

const staffSalaries = { month: '2026-11', rows: [{ staffId: 's1', staffCode: 'CA-0007', name: 'Deepa Nair', role: 'call_agent', joinedAt: '2026-08-01T04:00:00Z', joinedOn: '2026-08-01', monthlyPaise: 1800000, effectiveFromMonth: '2026-08', upcoming: null, history: [] }] };

describe('Salaries (FN-Salaries)', () => {
  it('shows the sheet from attendance and sends the total to the CEO', async () => {
    const api = mockApi({
      ...common,
      'GET /finance/salaries': ({ url }: { url: URL }) => sheet({ month: url.searchParams.get('month') }),
      'GET /finance/staff-salaries': staffSalaries,
      'POST /finance/salaries/2026-10/prepare': sheet({ status: 'with_ceo' }),
    });
    signInAs('finance');
    renderScreen(<Salaries />, { portal: 'finance', path: '/finance/salaries', now: NOW });
    const table = await screen.findByRole('table', { name: /Salary sheet · October 2026/ });
    expect(await within(table).findByText('25 / 26')).toBeInTheDocument();
    expect(within(table).getByText('0h 30m')).toBeInTheDocument();
    expect(within(table).getByText('₹17,264.42')).toBeInTheDocument();
    expect(within(table).getByText('₹735.58')).toBeInTheDocument();
    // Finance sees salaries but only the CEO sets them.
    expect(await screen.findByText('Set by the CEO · only the CEO and Finance see salaries')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change pay' })).toBeNull();
    expect(screen.getByText(/How November will be paid/)).toBeInTheDocument();
    expect(api.calls('GET /finance/salaries').some((c) => c.query.get('month') === '2026-10')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Send the total to the CEO' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send to the CEO' }));
    await waitFor(() => expect(api.calls('POST /finance/salaries/2026-10/prepare')).toHaveLength(1));
  });

  it('pays one person with the UTR once the CEO has approved', async () => {
    const approved = sheet({ status: 'approved', run: { preparedBy: 'Nisha', preparedAt: '2026-10-31T10:00:00Z', approvedBy: 'Agastya', approvedAt: '2026-10-31T12:00:00Z', returnedBy: null, returnedAt: null, returnedReason: null, paidAt: null }, rows: [row({ line: { id: 'l1', status: 'unpaid', paidAt: null, utrLast4: null, paidFrom: null } })] });
    const api = mockApi({
      ...common,
      'GET /finance/salaries': approved,
      'GET /finance/staff-salaries': staffSalaries,
      'POST /finance/salaries/2026-10/lines/l1/pay': { paid: true, monthPaid: true },
    });
    signInAs('finance');
    renderScreen(<Salaries />, { portal: 'finance', path: '/finance/salaries', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Pay and record' }));
    const d = await screen.findByRole('dialog');
    await userEvent.type(within(d).getByLabelText(/UTR from the bank/), '431200001111');
    await userEvent.click(within(d).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.calls('POST /finance/salaries/2026-10/lines/l1/pay')[0]?.body).toEqual({ utr: '431200001111', paidFrom: 'bank_transfer' }));
  });

  it('blocks sending while someone has no monthly pay or a day is still open', async () => {
    mockApi({
      ...common,
      'GET /finance/salaries': sheet({ missingSalary: [{ staffId: 's2', staffCode: 'FA-0003', name: 'Kiran Kumar' }], openDays: [{ name: 'Deepa Nair (CA-0007)', days: ['2026-10-30'] }] }),
      'GET /finance/staff-salaries': staffSalaries,
    });
    signInAs('finance');
    renderScreen(<Salaries />, { portal: 'finance', path: '/finance/salaries', now: NOW });
    expect(await screen.findByText(/The CEO sets a monthly pay first for Kiran Kumar/)).toBeInTheDocument();
    expect(screen.getByText(/Days still open \(attendance not final\): Deepa Nair \(CA-0007\) 2026-10-30/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send the total to the CEO' })).toBeDisabled();
  });

  it('shows a correction carried from an approved month', async () => {
    mockApi({ ...common, 'GET /finance/salaries': sheet({ rows: [row({ correctionPaise: 69231, correctionNote: 'Paid back for September 2026' })] }), 'GET /finance/staff-salaries': staffSalaries });
    signInAs('finance');
    renderScreen(<Salaries />, { portal: 'finance', path: '/finance/salaries', now: NOW });
    expect(await screen.findByText('Correction +₹692.31')).toBeInTheDocument();
  });

  it('shows a leaver paid what they are owed, and a take-back carried to the next sheet', async () => {
    mockApi({
      ...common,
      'GET /finance/salaries': sheet({
        rows: [
          row({ correctionPaise: -1726442, carryForwardPaise: -300000, correctionNote: 'Taken back for September 2026' }),
          row({ staffId: 's9', staffCode: 'CA-0009', name: 'Gone Person', monthlyPaise: 0, grossPaise: 0, deductionsPaise: 0, correctionPaise: 50000, correctionOnly: true, netPaise: 50000 }),
        ],
      }),
      'GET /finance/staff-salaries': staffSalaries,
    });
    signInAs('finance');
    renderScreen(<Salaries />, { portal: 'finance', path: '/finance/salaries', now: NOW });
    expect((await screen.findAllByText('No longer on the staff')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹3,000 more to take back on the next sheet').length).toBeGreaterThan(0);
  });

  it('shows the error with a retry', async () => {
    mockApi({ ...common, 'GET /finance/salaries': apiError(500, 'Internal server error', 'req-sal'), 'GET /finance/staff-salaries': staffSalaries });
    signInAs('finance');
    renderScreen(<Salaries />, { portal: 'finance', path: '/finance/salaries', now: NOW });
    expect((await screen.findAllByText('Reference: req-sal')).length).toBeGreaterThan(0);
  });
});

describe("CEO's Salaries (C-Team-Salaries)", () => {
  it('shows the rupees from payroll and approves the total Finance sent', async () => {
    const api = mockApi({
      'GET /login-codes/pending': [],
      'GET /review-flags': [],
      'GET /refunds/due': [],
      'GET /finance/salaries': sheet({ status: 'with_ceo', run: { preparedBy: 'Nisha', preparedAt: '2026-10-31T10:00:00Z', approvedBy: null, approvedAt: null, returnedBy: null, returnedAt: null, returnedReason: null, paidAt: null, netPaise: 1726442 } }),
      'POST /finance/salaries/2026-10/approve': sheet({ status: 'approved' }),
      'GET /finance/staff-salaries': { month: '2026-11', rows: [{ ...staffSalaries.rows[0], staffId: 's2', name: 'Kiran Kumar', staffCode: 'FA-0003', monthlyPaise: null, effectiveFromMonth: null }] },
      'PUT /finance/staff-salaries/s2': { id: 'x' },
    });
    signInAs('ceo');
    renderScreen(<CeoSalaries />, { portal: 'ceo', path: '/ceo/team/salaries', now: NOW });
    expect(await screen.findByText('25 / 26')).toBeInTheDocument();
    expect(screen.getByText('Check: 1 absent')).toBeInTheDocument();
    expect(screen.getAllByText('₹18,000').length).toBeGreaterThan(0);
    expect(screen.getByText(/Nisha sent October 2026 pay/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve the total' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    // He approves exactly the total he saw.
    await waitFor(() => expect(api.calls('POST /finance/salaries/2026-10/approve')[0]?.body).toEqual({ netPaise: 1726442, preparedAt: '2026-10-31T10:00:00Z' }));
    expect(api.calls('GET /finance/salaries')[0].query.get('month')).toBe('2026-10');
    // Only the CEO sets salaries.
    await userEvent.click(await screen.findByRole('button', { name: 'Set pay' }));
    const d = await screen.findByRole('dialog');
    await userEvent.type(within(d).getByLabelText(/Monthly pay/), '20000');
    await userEvent.click(within(d).getByRole('button', { name: 'Monthly pay · Kiran Kumar' }));
    await waitFor(() => expect(api.calls('PUT /finance/staff-salaries/s2')[0]?.body).toEqual(expect.objectContaining({ monthlyPaise: 2000000 })));
  });
});

const tax = {
  month: '2026-10',
  label: 'October 2026',
  gst: { invoices: { count: 40, feePaise: 32000000, gstPaise: 5760000 }, creditNotes: { count: 1, feePaise: 800000, gstPaise: 144000 }, receipts: { count: 320 }, payablePaise: 5616000, ratePercent: 18, companyGstin: null },
  dates: [
    { key: 'gstr1', label: 'GSTR-1 (sales)', due: '2026-11-11', what: 'Invoice data ready', daysLeft: 0 },
    { key: 'gstr3b', label: 'GSTR-3B (pay GST)', due: '2026-11-20', what: 'Pay 56160.00 GST', daysLeft: 9 },
    { key: 'tds_pay', label: 'TDS we took', due: '2026-11-07', what: 'Nothing deducted yet', daysLeft: -4 },
    { key: 'tds_return', label: 'TDS returns', due: '2027-01-31', what: 'Every quarter · the CA', daysLeft: 81 },
  ],
  tdsReceivable: [{ id: 't1', business: 'Hotel Kamat', placementCode: 'PL-00098', invoiceCode: 'LAB/26-27/0098', amountPaise: 75000, note: '194J', status: 'certificate_due', recordedAt: '2026-10-20T06:00:00Z' }],
  tdsReceivableTotalPaise: 75000,
  referralTds: { financialYear: '2026-27', limitPaise: 2000000, nextPayoutPaise: 20000, rows: [{ referralId: 'r1', code: 'RF-00021', name: 'Sri Krishna Agencies', paidThisYearPaise: 1980000, pendingPaise: 20000, payouts: 99, status: 'crosses_next' }] },
  notes: { gst: '', referral: '' },
};

describe('Tax (FN-Tax)', () => {
  it('shows GST to pay, the dates, TDS taken by businesses and the referral TDS warning', async () => {
    const api = mockApi({ ...common, 'GET /finance/tax': tax, 'POST /finance/tds-receivables/t1/certificate-received': { ok: true } });
    signInAs('finance');
    renderScreen(<TaxPage />, { portal: 'finance', path: '/finance/tax', now: NOW });
    expect(await screen.findByText('₹56,160')).toBeInTheDocument();
    expect(screen.getByText('11 Nov · today')).toBeInTheDocument();
    expect(screen.getByText('Hotel Kamat')).toBeInTheDocument();
    expect(screen.getByText('Crosses ₹20,000 with the next payout')).toBeInTheDocument();
    expect(api.calls('GET /finance/tax')[0].query.get('month')).toBe('2026-10');
    await userEvent.click(screen.getByRole('button', { name: 'Mark certificate received' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'TDS certificate received' }));
    await waitFor(() => expect(api.calls('POST /finance/tds-receivables/t1/certificate-received')).toHaveLength(1));
  });
});

describe('Reports (FN-Reports)', () => {
  it('shows profit and loss and cash flow, and downloads the files for the CA', async () => {
    const api = mockApi({
      ...common,
      'GET /finance/reports': {
        period: { from: '2026-10-31T18:30:00Z', to: '2026-11-11T06:30:00Z', month: '2026-11' },
        profit: {
          revenue: { activationPaise: 15968000, activationCount: 320, placementFeePaise: 32000000, placementCount: 40, refundsPaise: 1193500, refundsCount: 3, netRevenuePaise: 46774500, gstCollectedPaise: 5760000 },
          expenses: { billsPaise: 12871000, payoutsPaise: 300000, salariesPaise: 41260000, salaryMonthsPending: [], totalPaise: 55091000 },
          profitPaise: -8316500,
        },
        cashFlow: { startPaise: 74830000, moneyInPaise: 53728000, moneyOutPaise: 59220500, out: { refundsAndPayoutsPaise: 1493500, expensesPaise: 12871000, salariesPaise: 41260000, returnedPaise: 0 }, endPaise: 69337500, daysClosed: 9, days: 11, note: 'Through the company account' },
      },
      'GET /finance/reports/books.csv': 'Date,In / out\n',
    });
    signInAs('finance');
    renderScreen(<Reports />, { portal: 'finance', path: '/finance/reports', now: NOW });
    expect((await screen.findAllByText('− ₹83,165')).length).toBeGreaterThan(0);
    expect(screen.getByText('Salaries (from payroll)')).toBeInTheDocument();
    expect(screen.getAllByText('₹6,93,375').length).toBe(2);
    const downloads = screen.getByRole('table', { name: 'Downloads for the CA' });
    await userEvent.click(within(downloads).getAllByRole('button', { name: 'Download (Excel)' })[0]);
    await waitFor(() => expect(api.calls('GET /finance/reports/books.csv')[0]?.query.get('month')).toBe('2026-11'));
  });
});

const review = (over: Record<string, unknown> = {}) => ({
  month: '2026-10',
  label: 'October 2026',
  status: 'open',
  canClose: true,
  allChecked: false,
  close: null,
  checklist: [
    { key: 'bank_days_closed', label: 'All bank days closed', ok: false, detail: '2 days not closed: 2026-10-30, 2026-10-31', count: 2, link: 'bank' },
    { key: 'credits_matched', label: 'All credits matched', ok: true, detail: 'Every credit is matched or returned', count: 0, link: 'money-in' },
    { key: 'payouts_done', label: 'Payouts and refunds done', ok: true, detail: 'Everything owed by the month end is paid', count: 0, link: 'payouts' },
    { key: 'salaries_released', label: 'Salaries released', ok: true, detail: 'All 21 paid', count: 0, link: 'salaries?month=2026-10' },
    { key: 'expenses_with_bills', label: 'Expenses with bills', ok: true, detail: 'Every expense has its bill and is settled', count: 0, link: 'expenses' },
  ],
  summary: { actions: 1, byFinanceWithinLimits: 1, approvedByCeo: 0, flagged: 0, moneyOutPaise: 49900 },
  actions: [{ id: 'payment:p1', subjectType: 'payment', subjectId: 'p1', at: '2026-10-02T06:00:00Z', doneBy: { id: 'f1', name: 'Nisha', role: 'finance' }, approvedByCeo: false, type: 'refund', what: 'Refund paid', record: 'JS-00121', amountPaise: 49900, proof: 'UTR 431190001122', mark: null }],
  nextMonth: '2026-11',
  ...over,
});

describe('Month-end review (FN-Review)', () => {
  it('shows the checklist and the actions; Finance cannot close', async () => {
    mockApi({ ...common, 'GET /finance/month-end': review() });
    signInAs('finance');
    renderScreen(<MonthEndReview />, { portal: 'finance', path: '/finance/review', now: NOW });
    expect(await screen.findByText('All bank days closed')).toBeInTheDocument();
    expect(screen.getByText(/2 days not closed/)).toBeInTheDocument();
    expect(screen.getByText('UTR 431190001122')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close October' })).toBeDisabled();
    expect(screen.getByText('Only the CEO closes the month.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Looks right' })).toBeNull();
  });

  it('lets the CEO mark an action and close the month with a note', async () => {
    const api = mockApi({
      'GET /login-codes/pending': [],
      'GET /review-flags': [],
      'GET /refunds/due': [],
      'GET /finance/month-end': review(),
      'POST /finance/month-end/2026-10/marks': { ok: true },
      'POST /finance/month-end/2026-10/close': { ok: true },
    });
    signInAs('ceo');
    renderScreen(<MonthEndReview />, { portal: 'ceo', path: '/ceo/month-end', now: NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Looks right' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Looks right' }));
    await waitFor(() => expect(api.calls('POST /finance/month-end/2026-10/marks')[0]?.body).toEqual({ subjectType: 'payment', subjectId: 'p1', mark: 'ok' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close October' }));
    const d = await screen.findByRole('dialog');
    await userEvent.type(within(d).getByLabelText(/Why it closes anyway/), 'Bank statement late');
    await userEvent.click(within(d).getByRole('button', { name: 'Close October 2026' }));
    await waitFor(() => expect(api.calls('POST /finance/month-end/2026-10/close')[0]?.body).toEqual({ note: 'Bank statement late' }));
  });

  it('shows a closed month and lets the CEO reopen it with a reason', async () => {
    const api = mockApi({
      'GET /login-codes/pending': [],
      'GET /review-flags': [],
      'GET /refunds/due': [],
      'GET /finance/month-end': review({ status: 'closed', canClose: false, close: { closedBy: 'Agastya', closedAt: '2026-11-03T06:00:00Z', note: null, reopenedBy: null, reopenedAt: null, reopenReason: null } }),
      'POST /finance/month-end/2026-10/reopen': { ok: true },
    });
    signInAs('ceo');
    renderScreen(<MonthEndReview />, { portal: 'ceo', path: '/ceo/month-end', now: NOW });
    expect(await screen.findByText(/Closed by Agastya/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reopen October' }));
    const d = await screen.findByRole('dialog');
    await userEvent.type(within(d).getByLabelText(/Why it is reopened/), 'Late bill');
    await userEvent.click(within(d).getByRole('button', { name: 'Reopen October 2026' }));
    await waitFor(() => expect(api.calls('POST /finance/month-end/2026-10/reopen')[0]?.body).toEqual({ reason: 'Late bill' }));
  });
});

const refundRow = (over: Record<string, unknown> = {}) => ({
  ref: 'js-11111111-1111-1111-1111-111111111111',
  kind: 'job_seeker',
  subject: { id: '11111111-1111-1111-1111-111111111111', code: 'JS-00197', name: 'Lakshmi Bai' },
  placement: null,
  amountPaise: 49900,
  why: '30-day guarantee ran out',
  check: { eligible: true, text: 'Eligible · checked by the system' },
  approval: 'within_limit',
  approvalText: 'Within your limit',
  state: 'due',
  paymentId: null,
  paymentCode: null,
  jobSeekerId: '11111111-1111-1111-1111-111111111111',
  placementId: null,
  daysOwed: 2,
  since: '2026-11-09T00:00:00Z',
  ...over,
});
const refundsSummary = { withinLimitCount: 1, toPayPaise: 49900, withCeoCount: 1, withCeoPaise: 1770000, paidThisMonthPaise: 1193500, paidThisMonthCount: 3, businessRefundLimitPaise: 1500000 };

describe('Refunds (FN-Refunds)', () => {
  it('approves and pays a ₹499 refund on the existing endpoints', async () => {
    const api = mockApi({
      ...common,
      'GET /finance/refunds': { rows: [refundRow(), refundRow({ ref: 'pay-2', kind: 'business', subject: { id: 'b1', code: 'BZ-00031', name: 'Hotel Annapoorna' }, placement: { id: 'pl1', code: 'PL-00061' }, amountPaise: 1770000, approval: 'with_ceo', approvalText: 'Over your limit · needs the CEO', state: 'with_ceo', paymentId: 'p2' })], summary: refundsSummary },
      'POST /job-seekers/11111111-1111-1111-1111-111111111111/refund': { id: 'pay-new', status: 'approved' },
      'POST /finance/payouts/pay-new/pay': { ok: true },
    });
    signInAs('finance');
    renderScreen(<Refunds />, { portal: 'finance', path: '/finance/refunds', now: NOW });
    expect(await screen.findByText('JS-00197 · Lakshmi Bai')).toBeInTheDocument();
    expect(screen.getByText('Over your limit · needs the CEO')).toBeInTheDocument();
    expect(screen.getAllByText(/₹17,700/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Approve and pay' }));
    const d = await screen.findByRole('dialog');
    await userEvent.type(within(d).getByLabelText(/Name the UPI app showed/), 'LAKSHMI BAI');
    await userEvent.type(within(d).getByLabelText(/UTR/), '431200002222');
    await userEvent.click(within(d).getByRole('button', { name: 'Approve and record payment' }));
    await waitFor(() => expect(api.calls('POST /finance/payouts/pay-new/pay')[0]?.body).toEqual({ utr: '431200002222', receiverNameShown: 'LAKSHMI BAI' }));
    expect(api.calls('POST /job-seekers/11111111-1111-1111-1111-111111111111/refund')).toHaveLength(1);
  });
});

describe('One refund (FN-Refund)', () => {
  it('shows every check and sends a business refund to the CEO', async () => {
    const ref = 'pl-22222222-2222-2222-2222-222222222222';
    const api = mockApi({
      ...common,
      [`GET /finance/refunds/${ref}`]: {
        ref,
        kind: 'business',
        row: refundRow({ ref, kind: 'business', placementId: '22222222-2222-2222-2222-222222222222', jobSeekerId: null, amountPaise: 800000 }),
        decided: null,
        business: { id: 'b1', code: 'BZ-00031', name: 'Green Leaf Café' },
        placement: { id: '22222222-2222-2222-2222-222222222222', code: 'PL-00072', role: 'cook', workerName: 'Arjun', joinedDate: null, dropoutReportedAt: '2026-10-20T06:00:00Z', status: 'dropped_out' },
        fee: { feePaise: 800000, gstPaise: 144000, totalPaise: 944000 },
        why: 'Claim accepted by Ravi · 15-day replacement search ended with no one accepted',
        amountPaise: 800000,
        percent: 100,
        checks: [
          { ok: true, text: 'Reported within 7 days of the worker leaving' },
          { ok: true, text: '₹8,000 is within your ₹15,000 limit' },
        ],
        payTo: { method: 'bank', masked: 'HDFC ****4471', verifiedName: 'Green Leaf Café', status: 'verified' },
        withinLimit: true,
        limitPaise: 1500000,
      },
      'POST /placements/22222222-2222-2222-2222-222222222222/refund': { id: 'p9', message: 'sent' },
    });
    signInAs('finance');
    renderScreen(<RefundDetail />, { portal: 'finance', path: `/finance/refunds/${ref}`, route: '/finance/refunds/:id', now: NOW });
    expect(await screen.findByText('Reported within 7 days of the worker leaving')).toBeInTheDocument();
    expect(screen.getByText('₹9,440 (₹8,000 + ₹1,440 GST)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and record payment' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Send to CEO' }));
    const d = await screen.findByRole('dialog');
    await userEvent.type(within(d).getByLabelText(/Why/), 'Owner disputes the dates');
    await userEvent.click(within(d).getByRole('button', { name: 'Send this refund to the CEO' }));
    await waitFor(() => expect(api.calls('POST /placements/22222222-2222-2222-2222-222222222222/refund')[0]?.body).toEqual({ sendToCeo: true, reason: 'Owner disputes the dates' }));
  });
});

describe('Notifications (FN-Notifications)', () => {
  it('lists the Finance bell, newest first, with who did the work', async () => {
    mockApi({
      ...common,
      'GET /notifications': {
        openCount: 1,
        unseenCount: 0,
        total: 2,
        items: [
          { id: 'n1', kind: 'salaries_to_release', title: 'October 2026 salaries ready to release', body: 'The CEO approved ₹4,12,600 for 21 people', link: '/finance/salaries?month=2026-10', subjectType: 'payroll_month', subjectId: '2026-10', status: 'open', seen: true, createdAt: '2026-11-11T04:30:00Z', seenAt: null, clearedAt: null, clearedReason: null, clearedBy: null },
          { id: 'n2', kind: 'refund_ready_to_pay', title: 'Refund PAY-1 ready for you', body: '₹499', link: '/finance/refunds/x', subjectType: 'payment', subjectId: 'x', status: 'cleared', seen: true, createdAt: '2026-11-11T02:30:00Z', seenAt: null, clearedAt: '2026-11-11T04:00:00Z', clearedReason: 'payment_completed', clearedBy: { id: 'f1', code: 'FN-1', name: 'Nisha', role: 'finance' } },
        ],
      },
    });
    signInAs('finance');
    renderScreen(<FinanceNotifications />, { portal: 'finance', path: '/finance/notifications', now: NOW });
    expect(await screen.findByText('October 2026 salaries ready to release')).toBeInTheDocument();
    expect(screen.getByText(/done by Nisha/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'refunds');
    expect(screen.queryByText('October 2026 salaries ready to release')).toBeNull();
  });
});

describe('Credit notes (FN-CreditNotes)', () => {
  it('says credit notes wait for the CA', async () => {
    mockApi(common);
    signInAs('finance');
    renderScreen(<CreditNotes />, { portal: 'finance', path: '/finance/invoices/credit-notes', now: NOW });
    expect(await screen.findByText('Credit notes start once the CA confirms GST on business refunds.')).toBeInTheDocument();
  });
});

describe('Payslip (CA14g-Payslip)', () => {
  const slip = {
    month: '2026-10',
    label: 'October 2026',
    status: 'paid',
    paidOn: '2026-11-01T05:00:00Z',
    company: { name: 'Laboura Private Limited', address: null, city: 'Bengaluru' },
    employee: { name: 'Deepa Nair', code: 'CA-0007', designation: 'Call agent', reportsTo: 'Ravi Shankar', joinedOn: '2026-08-01T04:00:00Z', paymentRefLast4: '4417', paidFrom: 'bank_transfer' },
    days: { salaryDays: 26, calendarDays: 31, paidDays: 25, lossOfPayDays: 1, notEmployedDays: 0, shortfallMinutes: 30 },
    earnings: [
      { key: 'basic', label: 'Basic', paise: 900000 },
      { key: 'hra', label: 'House rent allowance', paise: 360000 },
      { key: 'special', label: 'Special allowance', paise: 540000 },
    ],
    grossPaise: 1800000,
    deductions: [
      { key: 'pf', label: 'Provident fund (PF)', paise: 0, note: 'Added after company registration' },
      { key: 'esi', label: 'ESI', paise: 0, note: 'Added after company registration' },
      { key: 'professional_tax', label: 'Professional tax', paise: 0, note: 'Added after company registration' },
      { key: 'loss_of_pay', label: 'Loss of pay', paise: 58065, note: null },
      { key: 'shortfall', label: 'Shortfall not made up', paise: 3629, note: null },
    ],
    deductionsPaise: 61694,
    netPaise: 1738306,
    netInWords: 'Seventeen thousand three hundred eighty three rupees and six paise',
    note: '',
  };

  it("shows the person's own payslip in the standard format", async () => {
    const api = mockApi({ 'GET /payroll/my-payslips': { months: [{ month: '2026-10', label: 'October 2026', paidOn: '2026-11-01T05:00:00Z' }] }, 'GET /payroll/my-payslips/2026-10': slip });
    signInAs('call_agent');
    renderScreen(<MyPayslips />, { portal: 'call-agent', path: '/call-agent/attendance/payslip', now: NOW });
    expect(await screen.findByText('LABOURA PRIVATE LIMITED')).toBeInTheDocument();
    expect(screen.getByText('25 (1 loss of pay)')).toBeInTheDocument();
    expect(screen.getByText('Loss of pay · 1 day')).toBeInTheDocument();
    expect(screen.getAllByText('from registration')).toHaveLength(3);
    expect(screen.getByText('Shortfall not made up · 0h 30m')).toBeInTheDocument();
    expect(screen.getByText(/Seventeen thousand three hundred eighty three rupees/)).toBeInTheDocument();
    expect(screen.queryByText(/incentive/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
    expect(api.calls('GET /payroll/my-payslips/2026-10')).toHaveLength(1);
  });

  it('says when there is no payslip yet', async () => {
    mockApi({ 'GET /payroll/my-payslips': { months: [] } });
    signInAs('call_agent');
    renderScreen(<MyPayslips />, { portal: 'call-agent', path: '/call-agent/attendance/payslip', now: NOW });
    expect(await screen.findByText(/No payslip yet/)).toBeInTheDocument();
  });
});
