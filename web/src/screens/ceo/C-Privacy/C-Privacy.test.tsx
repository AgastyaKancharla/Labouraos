import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import Privacy from './index';
import { dueText } from './DataRequests';

const NOW = new Date('2026-11-16T06:30:00Z'); // 16 Nov, 12:00 IST
const common = { 'GET /login-codes/pending': [], 'GET /review-flags': [], 'GET /refunds/due': [], 'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: NOW.toISOString() } };
const privacy = {
  summary: { fullConsent: 320, withdrawalsThisMonth: 4, erasuresThisMonth: 1, noticeVersion: '3' },
  purposes: [],
  withdrawals: [],
  erasures: [{ id: 'e1', at: '2026-11-02T05:00:00Z', entityType: 'job_seeker', entityCode: 'JS-00090', by: 'Agastya', reason: 'asked on a call' }],
  noticeVersions: [],
  businesses: { total: 54, signedAndRecording: 54 },
  partners: { total: 22, termsAndRecording: 20 },
};
const base = {
  kind: 'erasure',
  subjectType: 'job_seeker',
  details: null,
  outcome: null,
  outcomeNote: null,
  loggedBy: { id: 'c', name: 'Agastya' },
  closedBy: null,
  closedAt: null,
};
const register = {
  dueDays: 30,
  summary: { open: 2, overdue: 1, closedThisMonth: 1 },
  rows: [
    { ...base, id: 'r1', code: 'DR-00001', subjectCode: 'JS-00104', receivedOn: '2026-10-10', dueOn: '2026-11-09', daysLeft: -7, overdue: true, status: 'open' },
    { ...base, id: 'r2', code: 'DR-00002', kind: 'correction', subjectType: 'business', subjectCode: 'BZ-00019', details: 'Owner name spelling', receivedOn: '2026-11-10', dueOn: '2026-12-10', daysLeft: 24, overdue: false, status: 'in_progress' },
    { ...base, id: 'r3', code: 'DR-00003', kind: 'access', subjectType: 'referral', subjectCode: 'RF-00007', receivedOn: '2026-11-01', dueOn: '2026-12-01', daysLeft: null, overdue: false, status: 'closed', outcome: 'done', outcomeNote: 'Copy sent by WhatsApp', closedBy: { id: 'c', name: 'Agastya' }, closedAt: '2026-11-05T09:00:00Z' },
  ],
};
const render = () => {
  signInAs('ceo');
  return renderScreen(<Privacy />, { portal: 'ceo', path: '/ceo/privacy', now: NOW });
};
const consents = { 'GET /ceo/privacy/consents': { rows: [], total: 0, page: 1, pageSize: 25, summary: null } };

describe('C-Privacy data request register', () => {
  it('lists every request with received date, who asked, due date, status, who logged it and the outcome', async () => {
    mockApi({ ...common, ...consents, 'GET /ceo/privacy': privacy, 'GET /data-requests': register });
    render();
    const overdue = await screen.findByTestId('data-request-DR-00001');
    expect(within(overdue).getByText('JS-00104')).toBeInTheDocument();
    expect(within(overdue).getByText('Delete my data')).toBeInTheDocument();
    expect(within(overdue).getByText('7 days late')).toBeInTheDocument();
    expect(within(overdue).getByText('Overdue')).toBeInTheDocument();
    expect(within(overdue).getByText('10 Oct 2026')).toBeInTheDocument();
    expect(within(overdue).getByText('Agastya')).toBeInTheDocument();

    const inProgress = screen.getByTestId('data-request-DR-00002');
    expect(within(inProgress).getByText('Correct my data')).toBeInTheDocument();
    expect(within(inProgress).getByText('Owner name spelling')).toBeInTheDocument();
    expect(within(inProgress).getByText('In 24 days')).toBeInTheDocument();
    expect(within(inProgress).getByText('In progress')).toBeInTheDocument();

    const closed = screen.getByTestId('data-request-DR-00003');
    expect(within(closed).getByText('Closed 5 Nov 2026')).toBeInTheDocument();
    expect(within(closed).getByText('Done')).toBeInTheDocument();
    expect(within(closed).getByText('Copy sent by WhatsApp')).toBeInTheDocument();
    expect(within(closed).queryByRole('button', { name: 'Handle' })).not.toBeInTheDocument();

    // The tile counts open requests; completed erasures are still listed.
    expect(screen.getByText('Data requests open')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();
    expect(screen.getByText('JS-00090')).toBeInTheDocument();
  });

  it('the CEO logs a request with what was asked, the code, the day it arrived and a note', async () => {
    const api = mockApi({
      ...common,
      ...consents,
      'GET /ceo/privacy': privacy,
      'GET /data-requests': { ...register, rows: [] },
      'POST /data-requests': { ...register.rows[0], id: 'r9', code: 'DR-00009', dueOn: '2026-12-14' },
    });
    render();
    expect(await screen.findByText(/No data requests yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Log a request' }));
    const d = await screen.findByRole('dialog');
    const submit = within(d).getByRole('button', { name: 'Log the request' });
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(within(d).getByLabelText(/What they asked for/), 'erasure');
    await userEvent.type(within(d).getByLabelText(/Who asked/), 'js-00104');
    fireEvent.change(within(d).getByLabelText(/Received on/), { target: { value: '2026-11-14' } });
    await userEvent.type(within(d).getByLabelText(/Details/), 'Asked on a recorded call');
    await userEvent.click(submit);
    await waitFor(() =>
      expect(api.calls('POST /data-requests')[0].body).toEqual({ kind: 'erasure', subjectCode: 'JS-00104', receivedOn: '2026-11-14', details: 'Asked on a recorded call' }),
    );
    expect(await screen.findByText('DR-00009 logged · due 14 Dec 2026')).toBeInTheDocument();
  });

  it('marks a request in progress and closes it with the outcome and what was done', async () => {
    const api = mockApi({
      ...common,
      ...consents,
      'GET /ceo/privacy': privacy,
      'GET /data-requests': register,
      'PATCH /data-requests/r1': { ...register.rows[0], status: 'in_progress' },
      'POST /data-requests/r2/close': { ...register.rows[1], status: 'closed' },
    });
    render();
    const row = await screen.findByTestId('data-request-DR-00001');
    await userEvent.click(within(row).getByRole('button', { name: 'Start' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark in progress' }));
    await waitFor(() => expect(api.calls('PATCH /data-requests/r1')[0].body).toEqual({ status: 'in_progress' }));

    const second = screen.getByTestId('data-request-DR-00002');
    expect(within(second).queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    await userEvent.click(within(second).getByRole('button', { name: 'Handle' }));
    const d = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(d).getByLabelText('Outcome'), 'partly_done');
    await userEvent.type(within(d).getByLabelText(/What was done/), 'Name corrected; GST name needs a document');
    await userEvent.click(within(d).getByRole('button', { name: 'Close the request' }));
    await waitFor(() =>
      expect(api.calls('POST /data-requests/r2/close')[0].body).toEqual({ outcome: 'partly_done', outcomeNote: 'Name corrected; GST name needs a document' }),
    );
  });

  it('shows the register error with a retry and keeps the rest of the page', async () => {
    mockApi({ ...common, ...consents, 'GET /ceo/privacy': privacy, 'GET /data-requests': apiError(500, 'Internal server error', 'req-dr') });
    render();
    expect(await screen.findByText('Reference: req-dr')).toBeInTheDocument();
    expect(screen.getByText('JS-00090')).toBeInTheDocument();
  });

  it('words the due date', () => {
    expect(dueText({ daysLeft: 6, status: 'open', closedAt: null })).toBe('In 6 days');
    expect(dueText({ daysLeft: 1, status: 'open', closedAt: null })).toBe('Tomorrow');
    expect(dueText({ daysLeft: 0, status: 'in_progress', closedAt: null })).toBe('Due today');
    expect(dueText({ daysLeft: -1, status: 'open', closedAt: null })).toBe('1 day late');
  });
});

describe('C-Privacy data breaches (72 hours)', () => {
  const breach = {
    id: 'b1',
    code: 'BR-00001',
    discoveredAt: '2026-11-15T06:30:00Z',
    reportDueAt: '2026-11-18T06:30:00Z',
    summary: 'Lost laptop with an export',
    dataAffected: 'Names and masked phones',
    peopleAffected: 40,
    status: 'open',
    steps: [{ at: '2026-11-15T06:31:00Z', text: 'Breach logged' }],
    told: [],
    boardToldAt: null,
    overdue: false,
    hoursLeft: 48,
    closedAt: null,
  };
  it('shows the Data breaches tile, the deadline, steps and who was told, and logs a new breach', async () => {
    const api = mockApi({
      ...common,
      ...consents,
      'GET /ceo/privacy': privacy,
      'GET /data-requests': register,
      'GET /ceo/privacy/breaches': { summary: { total: 1, open: 1, overdue: 0, boardToldInTime: 0, reportHours: 72 }, rows: [breach] },
      'POST /ceo/privacy/breaches': { ...breach, id: 'b2' },
    });
    render();
    expect(await screen.findByText('Data breaches')).toBeInTheDocument();
    const card = await screen.findByRole('article', { name: 'Breach BR-00001' });
    expect(within(card).getByText('48 h left to tell the Board')).toBeInTheDocument();
    expect(within(card).getByText('Nobody yet')).toBeInTheDocument();
    expect(within(card).getByText(/Breach logged/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Close' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Log a breach' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/What happened/), 'Wrong file shared');
    await userEvent.type(within(dialog).getByLabelText(/What data/), 'Business names');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log the breach' }));
    await waitFor(() => expect(api.calls('POST /ceo/privacy/breaches')[0]?.body).toMatchObject({ summary: 'Wrong file shared', dataAffected: 'Business names' }));
  });
});
