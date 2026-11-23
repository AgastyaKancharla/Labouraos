import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import { homeData, NOW, workItem } from '../_lib/fixtures';
import Home from './index';

const path = { portal: 'call-agent' as const, path: '/call-agent', now: NOW };

// 22 Nov: the "Stuck registrations" card reads GET /profile-stuck/list (job seekers, businesses, partners).
const stuckRow = (over: Record<string, unknown> = {}) => ({
  kind: 'job_seeker', id: 'js9', code: 'JS-00301', name: 'Pooja Nair', owner: { name: 'Me', code: 'CA-1' }, ownerId: 'me',
  step: 'payment', state: 'stuck', reason: null, waitingForTeamLead: false, actions: ['payment_link', 'someone_else_pays'], since: '2026-11-10T05:00:00Z', ...over,
});
const stuckList = (rows = [stuckRow()]) => ({ 'GET /profile-stuck/list': { rows } });

describe('Call agent Home (CA03)', () => {
  it('shows today’s numbers, the work list with the near-refund person first, targets, stuck registrations and counts without rupees', async () => {
    mockApi({ 'GET /call-work/home': homeData(), ...stuckList() });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    expect(await screen.findByRole('button', { name: '☎ Call next · Ramesh Gowda' })).toBeEnabled();
    const rows = screen.getAllByTestId('work-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('Ramesh Gowda')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Day 27 of 30')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Offer reply by 6 PM')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Callback 11:30 AM')).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
    expect(screen.getByText('1h 48m')).toBeInTheDocument();
    expect(screen.getByText('team avg 21')).toBeInTheDocument();
    expect(screen.getByText('4%')).toBeInTheDocument();
    expect(await screen.findByText('Stuck registrations (1)')).toBeInTheDocument();
    // 23 Nov: the row style of the console lists — bold name, status line, one button; tapping opens CA04.
    const stuck = screen.getByTestId('stuck-row');
    expect(within(stuck).getByRole('link', { name: /Pooja Nair/ })).toHaveAttribute('href', '/call-agent/people/JS-00301');
    expect(within(stuck).getByTestId('row-status')).toHaveTextContent('Stuck at payment');
    expect(stuck).toHaveTextContent('Job seeker · JS-00301');
    expect(within(stuck).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('1 of your people are near day 30 · no suitable offer yet')).toBeInTheDocument();
    expect(screen.queryByText(/₹1,497/)).not.toBeInTheDocument();
    const done = screen.getByTestId('done-row');
    expect(within(done).getByRole('link', { name: /Kavya Reddy/ })).toHaveAttribute('href', '/call-agent/people/JS-00400');
    expect(within(done).getByTestId('row-status')).toHaveTextContent(/^Registered · /);
    expect(within(done).getByTestId('row-done')).toHaveTextContent('Consent given');
  });

  it('filters the work list with the chips', async () => {
    mockApi({ 'GET /call-work/home': homeData() });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    await userEvent.click(await screen.findByRole('button', { name: 'Offers 1' }));
    expect(screen.getAllByTestId('work-row')).toHaveLength(1);
    expect(screen.getByText('Suresh Patil')).toBeInTheDocument();
  });

  it('Call next asks the server for the next person and opens the call', async () => {
    const api = mockApi({
      'GET /call-work/home': homeData(),
      'POST /call-work/call-next': { placed: true, blocked: null, callingHours: { start: '09:00', end: '21:00' }, item: homeData().work.items[0], callRecordId: 'c1' },
    });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    await userEvent.click(await screen.findByRole('button', { name: '☎ Call next · Ramesh Gowda' }));
    await waitFor(() => expect(screen.getByTestId('navigated-away')).toBeInTheDocument());
    expect(api.calls('POST /call-work/call-next')[0]!.body).toEqual({ skip: [] });
  });

  it('explains why Call next is off when the agent is not Available', async () => {
    mockApi({ 'GET /call-work/home': homeData({ canCall: false, attendanceStatus: 'short_break' }) });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    expect(await screen.findByText(/Calls start when your status is Available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '☎ Call next · Ramesh Gowda' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Open Attendance' })).toBeInTheDocument();
  });

  it('resends a stuck registration link with one tap', async () => {
    const api = mockApi({
      'GET /call-work/home': homeData(),
      ...stuckList([stuckRow(), stuckRow({ id: 'js11', code: 'JS-00311', name: 'Link Person', step: 'selfie', actions: ['registration_link'] })]),
      'POST /job-seekers/js9/resend-payment': { ok: true },
      'POST /consent/links': { ok: true },
    });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    // Stuck at payment: the payment link (not the registration link); a link not finished: Resend.
    await userEvent.click(await screen.findByRole('button', { name: 'Send payment link' }));
    await waitFor(() => expect(api.calls('POST /job-seekers/js9/resend-payment')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Resend registration link' }));
    await waitFor(() => expect(api.calls('POST /consent/links')).toHaveLength(1));
    expect(api.calls('POST /consent/links')[0]!.body).toEqual({ jobSeekerId: 'js11' });
  });

  it('21 Nov fixes: missed calls show the day and repeats; new callers stay on the list until handled; a do-not-call person is locked', async () => {
    const api = mockApi({
      'GET /call-work/home': homeData({
        work: {
          items: [
            workItem({ key: 'inbound:cb1', kind: 'missed_call', category: 'callbacks', priority: false, daysLeft: null, guaranteeDay: null, guaranteeDays: null, dueAt: '2026-11-10T04:30:00Z', detail: { callbackTaskId: 'cb1', count: 3, lastCalledAt: '2026-11-10T05:30:00Z' } }),
            workItem({ key: 'follow_up:f1', kind: 'follow_up', category: 'follow_ups', subjectId: 'js5', name: 'Blocked Person', priority: false, daysLeft: null, callable: false, lockedReason: 'do_not_call', detail: { followUpKind: 'not_selected_day_7' } }),
          ],
          counts: { all: 2, callbacks: 1, follow_ups: 1, offers: 0, new_leads: 0, priority: 0, app_signups: 0 },
        },
        newCallers: [{ callbackTaskId: 'cb9', callbackTaskIds: ['cb9', 'cb10'], count: 2, maskedPhone: '******7788', firstCalledAt: '2026-11-11T04:00:00Z', lastCalledAt: '2026-11-11T05:00:00Z' }],
        stuck: [
          { jobSeekerId: 'js9', code: 'JS-00301', name: 'Pooja Nair', maskedPhone: '******6643', trade: 'Delivery', step: 'payment_failed', failures: 2, linkLive: true, since: '2026-11-10T05:00:00Z' },
          { jobSeekerId: 'js10', code: 'JS-00302', name: 'Waiting Wilson', maskedPhone: '******6644', trade: 'Delivery', step: 'id_team_lead_check', failures: 0, linkLive: true, waitingForTeamLead: true, since: '2026-11-10T05:00:00Z' },
        ],
      }),
      ...stuckList([stuckRow(), stuckRow({ id: 'js10', code: 'JS-00302', name: 'Waiting Wilson', step: 'id_check', state: 'in_progress', waitingForTeamLead: true, actions: [] })]),
      'POST /telephony/callbacks/cb9/complete': { ok: true },
    });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    expect(await screen.findByText('Called us 3× · last Yesterday 11 AM')).toBeInTheDocument();
    expect(screen.getByText(/asked not to be called/)).toBeInTheDocument();
    const callers = screen.getByTestId('new-callers');
    expect(within(callers).getByText('New callers (1)')).toBeInTheDocument();
    expect(within(callers).getByRole('link', { name: /New caller \*\*\*\*\*\*7788 — register as…/ })).toHaveAttribute('href', expect.stringContaining('task=cb9'));
    // 22 Nov: both are listed and counted; waiting for the Team Lead's ID check has no resend.
    expect(await screen.findByText('Stuck registrations (2)')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Send payment link' })).toHaveLength(1);
    expect(screen.getByText("Waiting for the Team Lead's ID check")).toBeInTheDocument();
    // Nothing to send: "Waiting" on the right instead of a button.
    const waitingRow = screen.getAllByTestId('stuck-row')[1]!;
    expect(within(waitingRow).getByTestId('row-waiting')).toHaveTextContent('Waiting');
    expect(within(waitingRow).queryByRole('button')).toBeNull();
    await userEvent.click(within(callers).getByRole('button', { name: 'Not a lead' }));
    await waitFor(() => expect(api.calls('POST /telephony/callbacks/cb9/complete')).toHaveLength(1));
  });

  it('shows the empty list and an error with retry', async () => {
    let fail = true;
    mockApi({
      'GET /call-work/home': () =>
        fail ? apiError(500, 'Internal server error') : homeData({ work: { items: [], counts: { all: 0, callbacks: 0, follow_ups: 0, offers: 0, new_leads: 0, priority: 0, app_signups: 0 } }, callNext: null }),
    });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    const retry = await screen.findByRole('button', { name: /try again/i });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('Nothing on your list right now.')).toBeInTheDocument();
  });

  it('22 Nov: stuck businesses and referral partners are listed with their buttons; Done today names them too', async () => {
    const api = mockApi({
      'GET /call-work/home': homeData({
        doneToday: [
          { kind: 'business_registered', at: '2026-11-11T05:00:00Z', name: 'Zoom food court', code: 'BZ-00005', status: 'lead', extra: null },
          { kind: 'partner_registered', at: '2026-11-11T05:10:00Z', name: 'Antony G', code: 'RF-00044', status: 'registered', extra: null },
        ],
      }),
      ...stuckList([
        stuckRow({ kind: 'business', id: 'b5', code: 'BZ-00005', name: 'Zoom food court', step: 'agreement', state: 'not_started', actions: ['agreement_link'] }),
        stuckRow({ kind: 'referral', id: 'rf4', code: 'RF-00044', name: 'Antony G', step: 'selfie', state: 'not_started', actions: ['partner_terms_link'] }),
      ]),
      'POST /businesses/b5/agreement-links': { ok: true },
      'POST /referrals/rf4/terms-links': { ok: true },
    });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    expect(await screen.findByText('Stuck registrations (2)')).toBeInTheDocument();
    const [biz, partner] = screen.getAllByTestId('stuck-row');
    expect(within(biz!).getByText('Zoom food court')).toBeInTheDocument();
    expect(biz).toHaveTextContent('Business · BZ-00005');
    expect(within(biz!).getByTestId('row-status')).toHaveTextContent('Agreement not signed');
    expect(within(biz!).getByRole('link', { name: /Zoom food court/ })).toHaveAttribute('href', '/call-agent/people/BZ-00005');
    expect(partner).toHaveTextContent('Referral partner · RF-00044');
    expect(within(partner!).getByTestId('row-status')).toHaveTextContent('Stuck at the selfie');
    await userEvent.click(within(biz!).getByRole('button', { name: 'Send agreement link' }));
    await waitFor(() => expect(api.calls('POST /businesses/b5/agreement-links')).toHaveLength(1));
    await userEvent.click(within(partner!).getByRole('button', { name: 'Send partner terms link' }));
    await waitFor(() => expect(api.calls('POST /referrals/rf4/terms-links')).toHaveLength(1));
    const [bizDone, partnerDone] = screen.getAllByTestId('done-row');
    expect(within(bizDone!).getByTestId('row-status')).toHaveTextContent(/^Business registered · /);
    expect(within(bizDone!).getByRole('link', { name: /Zoom food court/ })).toHaveAttribute('href', '/call-agent/people/BZ-00005');
    expect(within(partnerDone!).getByTestId('row-status')).toHaveTextContent(/^Referral partner registered · /);
  });
});
