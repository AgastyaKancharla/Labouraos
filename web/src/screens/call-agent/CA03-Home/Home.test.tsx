import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import { homeData, NOW } from '../_lib/fixtures';
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

  it('shows the empty list and an error with retry', async () => {
    let fail = true;
    mockApi({
      'GET /call-work/home': () =>
        fail ? apiError(500, 'Internal server error') : homeData({ work: { items: [], counts: { all: 0, callbacks: 0, follow_ups: 0, offers: 0, new_leads: 0, priority: 0 } }, callNext: null }),
    });
    signInAs('call_agent');
    renderScreen(<Home />, path);
    const retry = await screen.findByRole('button', { name: /try again/i });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByText('Nothing on your list right now.')).toBeInTheDocument();
  });
});
