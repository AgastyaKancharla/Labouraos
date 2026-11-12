import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppProviders, createQueryClient } from '../../../App';
import { ATT_NOW, balanceFixture, endedToday, istAt, monthFixture, notStartedToday, onBreakToday, openToday } from '../../../attendance/fixtures';
import { AppShell } from '../../../components/AppShell';
import { NowContext } from '../../../lib/useNow';
import { portalByKey } from '../../../portals';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import Attendance from './index';

const path = { portal: 'call-agent' as const, path: '/call-agent/attendance', now: ATT_NOW };
const monthRoutes = { 'GET /attendance/month': monthFixture(), 'GET /attendance/leave/balance': balanceFixture };

describe('Call agent attendance (CA14, CA14b, CA14c, CA14d)', () => {
  it('before the day starts: greeting, shift, Start my day, yesterday, this month and leave left (CA14)', async () => {
    const api = mockApi({
      'GET /attendance/today': notStartedToday(),
      'POST /attendance/login': openToday({ loginAt: istAt('09:31'), segments: [{ status: 'available', startedAt: istAt('09:31'), endedAt: null, source: 'staff', approved: null }], statusSince: istAt('09:31') }),
      ...monthRoutes,
    });
    signInAs('call_agent');
    renderScreen(<Attendance />, path);
    expect(await screen.findByText('Good morning, Deepa')).toBeInTheDocument();
    expect(document.querySelector('.lb-att-hero .lb-att-muted')).toHaveTextContent('Your shift today: 9:30 AM – 6:30 PM. Start your day to begin your attendance. Calls and your list unlock after you start.');
    expect(screen.getByText('9:30 AM – 6:30 PM').tagName).toBe('STRONG');
    expect(screen.getByText('The time comes from Laboura’s server, not this computer. Starting after 9:40 AM is marked late.')).toBeInTheDocument();
    // Yesterday was Sunday 8 Nov (no working day); the month is 40m short; 3 leaves left.
    expect(await screen.findByText('no working day recorded')).toBeInTheDocument();
    expect(await screen.findByText('0h 40m short')).toBeInTheDocument();
    expect(screen.getByText('make up by 30 Nov or it’s deducted')).toBeInTheDocument();
    expect(await screen.findByText('1 casual · 2 emergency')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    const start = screen.getAllByRole('button', { name: 'Start my day' }).find((b) => b.classList.contains('lb-att-cta'))!;
    await userEvent.click(start);
    await waitFor(() => expect(api.calls('POST /attendance/login')).toHaveLength(1));
    expect(api.calls('POST /attendance/login')[0]!.body).toEqual({});
    expect(await screen.findByText('● Available · since 9:31 AM')).toBeInTheDocument();
  });

  it('the open day: status banner, tiles, the status select, the timeline and End my day (CA14b)', async () => {
    const api = mockApi({
      'GET /attendance/today': openToday(),
      'POST /attendance/status': ({ body }: { body: { status: string } }) => openToday({ status: body.status, statusSince: istAt('11:30') }),
    });
    signInAs('call_agent');
    renderScreen(<Attendance />, path);
    expect(await screen.findByText('● Available · since 11:20 AM')).toBeInTheDocument();
    expect(screen.getByText('Calls are coming to you')).toBeInTheDocument();
    expect(screen.getAllByText('9:31 AM').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Shift 9:30 AM – 6:30 PM · On time')).toBeInTheDocument();
    expect(screen.getByText('3h 34m')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Production' })).toHaveAttribute('aria-valuenow', '45');
    expect(screen.getByText('Lunch 0m of 30m · meetings 25m')).toBeInTheDocument();
    expect(screen.getByText('On call, After-call notes and Idle are set automatically.')).toBeInTheDocument();

    const timeline = screen.getByRole('list', { name: 'Today so far' });
    const rows = within(timeline).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      '9:31 AMLogged in · Available29m',
      '10:00 AMTeam meeting25m',
      '10:25 AMAvailable · 14 calls40m',
      '11:05 AMShort break15m',
      '11:20 AMAvailablenow',
    ]);

    const select = screen.getByRole('combobox', { name: 'Change my status' });
    expect(within(select).queryByRole('option', { name: /On call/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 'training');
    await waitFor(() => expect(api.calls('POST /attendance/status')[0]?.body).toEqual({ status: 'training' }));
    expect(await screen.findByText('● Training · since 11:30 AM')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My attendance, leave & payslips →' })).toHaveAttribute('href', '/call-agent/attendance/history');
    await userEvent.click(screen.getByRole('button', { name: 'End my day' }));
    expect(screen.getByRole('dialog', { name: 'End your day?' })).toBeInTheDocument();
  });

  it('marks a late login on the tile', async () => {
    mockApi({ 'GET /attendance/today': openToday({ loginAt: istAt('09:52'), lateMinutes: 22 }) });
    signInAs('call_agent');
    renderScreen(<Attendance />, path);
    expect(await screen.findByText('Shift 9:30 AM – 6:30 PM · Late · 22 min')).toBeInTheDocument();
  });

  it('on a break: the countdown, then red with the Team Lead told once it runs over (CA14c)', async () => {
    const api = mockApi({ 'GET /attendance/today': onBreakToday('11:24'), 'POST /attendance/status': openToday({ statusSince: istAt('11:30') }) });
    signInAs('call_agent');
    const view = renderScreen(<Attendance />, { ...path, now: new Date(new Date(istAt('11:30')).getTime() + 20_000) });
    expect(await screen.findByText('08:40 left')).toBeInTheDocument();
    expect(screen.getByText(/Started 11:24 AM\. Calls are stopped for you\. After 15 minutes the timer turns red/)).toBeInTheDocument();
    expect(screen.getByText(/Short break number 2 today \(15m \+ 6m so far\)\./)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'I’m back — Available' })[0]!);
    await waitFor(() => expect(api.calls('POST /attendance/status')[0]?.body).toEqual({ status: 'available' }));
    view.unmount();

    mockApi({ 'GET /attendance/today': onBreakToday('11:10') });
    signInAs('call_agent');
    renderScreen(<Attendance />, path);
    expect(await screen.findByText('05:00 over')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Over the 15 minutes allowed — your Team Lead has been told.');
    expect(document.querySelector('.lb-att-hero')).toHaveClass('lb-att-hero--over');
  });

  it('after End my day: the summary that goes to the Team Lead (CA14d)', async () => {
    mockApi({ 'GET /attendance/today': endedToday() });
    signInAs('call_agent');
    renderScreen(<Attendance />, path);
    expect(await screen.findByText('Day ended · 6:42 PM')).toBeInTheDocument();
    expect(screen.getByText('Production (incl. 25m meetings)')).toBeInTheDocument();
    expect(screen.getByText('8h 06m ✓')).toBeInTheDocument();
    expect(screen.getByText('15m + 15m')).toBeInTheDocument();
    expect(screen.getByText('30m')).toBeInTheDocument();
    expect(screen.getByText('5m')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Full day')).toHaveClass('tag', 'tg');
    expect(screen.getByRole('link', { name: 'Close' })).toHaveAttribute('href', '/call-agent');
  });

  it('a day closed without End my day is flagged', async () => {
    mockApi({ 'GET /attendance/today': endedToday({ flagged: true, closedReason: 'auto_closed_no_logout', dayType: 'half', productionSeconds: 4 * 3600 }) });
    signInAs('call_agent');
    renderScreen(<Attendance />, path);
    expect(await screen.findByText('You didn’t end your day, so it closed at your last activity and is flagged for your Team Lead.')).toBeInTheDocument();
    expect(screen.getByText('Half day')).toHaveClass('tr');
  });

  it('shows the error with a retry', async () => {
    mockApi({ 'GET /attendance/today': apiError(500, 'Internal server error') });
    signInAs('call_agent');
    renderScreen(<Attendance />, path);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('right after sign-in goes straight to Home when the day has already started', async () => {
    mockApi({ 'GET /attendance/today': openToday() });
    signInAs('call_agent');
    const portal = portalByKey('call-agent');
    render(
      <NowContext.Provider value={() => ATT_NOW}>
        <AppProviders queryClient={createQueryClient()}>
          <MemoryRouter initialEntries={[{ pathname: '/call-agent/attendance', state: { landing: true } }]}>
            <Routes>
              <Route path="/call-agent/attendance" element={<AppShell portal={portal}><Attendance /></AppShell>} />
              <Route path="/call-agent" element={<div data-testid="home" />} />
            </Routes>
          </MemoryRouter>
        </AppProviders>
      </NowContext.Provider>,
    );
    expect(await screen.findByTestId('home')).toBeInTheDocument();
  });

  it('right after sign-in stays on Start my day when the day has not started', async () => {
    mockApi({ 'GET /attendance/today': notStartedToday(), ...monthRoutes });
    signInAs('call_agent');
    const portal = portalByKey('call-agent');
    render(
      <NowContext.Provider value={() => ATT_NOW}>
        <AppProviders queryClient={createQueryClient()}>
          <MemoryRouter initialEntries={[{ pathname: '/call-agent/attendance', state: { landing: true } }]}>
            <Routes>
              <Route path="/call-agent/attendance" element={<AppShell portal={portal}><Attendance /></AppShell>} />
              <Route path="/call-agent" element={<div data-testid="home" />} />
            </Routes>
          </MemoryRouter>
        </AppProviders>
      </NowContext.Provider>,
    );
    expect(await screen.findByText('Good morning, Deepa')).toBeInTheDocument();
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
  });
});
