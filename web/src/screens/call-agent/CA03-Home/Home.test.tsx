import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import { homeData, NOW, workItem } from '../_lib/fixtures';
import Home from './index';

const path = { portal: 'call-agent' as const, path: '/call-agent', now: NOW };

describe('Call agent Home (CA03)', () => {
  it('shows today’s numbers, the work list with the near-refund person first, targets, stuck registrations and counts without rupees', async () => {
    mockApi({ 'GET /call-work/home': homeData() });
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
    expect(screen.getByText('Stuck registrations (1)')).toBeInTheDocument();
    expect(screen.getByText(/Pooja Nair · UPI failed 2×/)).toBeInTheDocument();
    expect(screen.getByText('1 of your people are near day 30 · no suitable offer yet')).toBeInTheDocument();
    expect(screen.queryByText(/₹1,497/)).not.toBeInTheDocument();
    expect(screen.getByText('Kavya Reddy · registered')).toBeInTheDocument();
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
    const api = mockApi({ 'GET /call-work/home': homeData(), 'POST /consent/links': { ok: true } });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    await userEvent.click(await screen.findByRole('button', { name: 'Resend →' }));
    await waitFor(() => expect(api.calls('POST /consent/links')).toHaveLength(1));
    expect(api.calls('POST /consent/links')[0]!.body).toEqual({ jobSeekerId: 'js9' });
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
      'POST /telephony/callbacks/cb9/complete': { ok: true },
    });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    expect(await screen.findByText('Called us 3× · last Yesterday 11 AM')).toBeInTheDocument();
    expect(screen.getByText(/asked not to be called/)).toBeInTheDocument();
    const callers = screen.getByTestId('new-callers');
    expect(within(callers).getByText('New callers (1)')).toBeInTheDocument();
    expect(within(callers).getByRole('link', { name: /New caller \*\*\*\*\*\*7788 — register as…/ })).toHaveAttribute('href', expect.stringContaining('task=cb9'));
    // Waiting for the Team Lead's ID check: no Resend, not counted as stuck.
    expect(screen.getByText('Stuck registrations (1)')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Resend →' })).toHaveLength(1);
    expect(screen.getByText('nothing to do — the Team Lead checks the ID')).toBeInTheDocument();
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
});
