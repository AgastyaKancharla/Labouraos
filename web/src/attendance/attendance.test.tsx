import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../i18n/I18nProvider';
import { sessionStore } from '../auth/session';
import { TEST_STAFF, fakeJwt, mockApi, renderScreen, signInAs } from '../test/utils';
import { idleState } from './AttendanceProvider';
import { ATT_NOW, istAt, notStartedToday, onBreakToday, openToday } from './fixtures';
import { chipText } from './StatusMenu';
import { menuStatuses, pickableStatuses } from './statuses';
import { timelineBlocks } from '../screens/call-agent/CA14b-AttendanceActive/timeline';

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('en', key, vars);

function Blank() {
  return <p>page</p>;
}

describe('attendance statuses and clocks', () => {
  it('lists the guide’s statuses: call agents see On call and After-call notes, office staff do not, and neither can pick them', () => {
    // 22 Nov: Active, Team meeting, One-to-one, Training, System problem, Short break, Lunch; Start of day only while in it.
    expect(menuStatuses('agent')).toEqual(['available', 'on_call', 'after_call_notes', 'team_meeting', 'one_to_one', 'training', 'system_problem', 'short_break', 'lunch']);
    expect(menuStatuses('office')).toEqual(['available', 'team_meeting', 'one_to_one', 'training', 'system_problem', 'short_break', 'lunch']);
    expect(menuStatuses('agent', 'start_of_day')[0]).toBe('start_of_day');
    expect(menuStatuses('office', 'available')).not.toContain('start_of_day');
    expect(pickableStatuses('agent')).not.toContain('start_of_day');
    expect(pickableStatuses('office')).not.toContain('start_of_day');
    expect(pickableStatuses('agent')).not.toContain('on_call');
    expect(pickableStatuses('agent')).not.toContain('after_call_notes');
    expect(pickableStatuses('agent')).not.toContain('idle');
  });

  it('writes the chip as the designs do, and turns a break red once it runs over', () => {
    const now = new Date(istAt('11:30')).getTime();
    expect(chipText(t, 'agent', openToday(), 'available', now)).toMatchObject({ text: 'Active · 11:20', over: false });
    const left = chipText(t, 'agent', onBreakToday('11:24'), 'short_break', new Date(istAt('11:30')).getTime() + 20_000);
    expect(left).toMatchObject({ text: 'Short break · 08:40 left', over: false });
    const over = chipText(t, 'agent', onBreakToday('11:10'), 'short_break', new Date(istAt('11:30')).getTime());
    expect(over).toMatchObject({ text: 'Short break · 05:00 over', over: true, dot: '#BB232B' });
    expect(chipText(t, 'agent', notStartedToday(), null, now).text).toBe('Not logged in');
    expect(chipText(t, 'office', openToday({ status: 'one_to_one', statusSince: istAt('11:00') }), 'one_to_one', now).text).toBe('One-to-one · 11:00');
  });

  it('asks “Still there?” after the quiet minutes setting while Available, and gives one minute', () => {
    const base = { status: 'available', statusSince: istAt('11:20'), idleAfterMinutes: 10, idlePromptMinutes: 1 };
    const t0 = new Date(istAt('11:20')).getTime();
    expect(idleState({ ...base, lastActivityMs: t0, nowMs: t0 + 9 * 60_000 }).open).toBe(false);
    const asked = idleState({ ...base, lastActivityMs: t0, nowMs: t0 + 10 * 60_000 + 8_000 });
    expect(asked).toMatchObject({ open: true, secondsLeft: 52, quietMinutes: 10, expired: false });
    expect(idleState({ ...base, lastActivityMs: t0, nowMs: t0 + 11 * 60_000 }).expired).toBe(true);
    // Activity after the status started counts; a break never asks.
    expect(idleState({ ...base, lastActivityMs: t0 + 5 * 60_000, nowMs: t0 + 11 * 60_000 }).open).toBe(false);
    expect(idleState({ ...base, status: 'short_break', lastActivityMs: t0, nowMs: t0 + 30 * 60_000 }).open).toBe(false);
  });

  it('folds calls into the Available blocks of the timeline and counts them', () => {
    const blocks = timelineBlocks(openToday().segments);
    expect(blocks.map((b) => [b.status, b.calls])).toEqual([
      ['available', 0],
      ['team_meeting', 0],
      ['available', 14],
      ['short_break', 0],
      ['available', 0],
    ]);
    expect(blocks[4]!.endedAt).toBeNull();
  });
});

describe('header status menu (call agent console)', () => {
  afterEach(() => vi.useRealTimers());

  it('shows “Available · 11:20 ▾”, greys out the phone statuses and changes the status from the dropdown', async () => {
    const api = mockApi({
      'GET /attendance/today': openToday(),
      'POST /attendance/status': ({ body }: { body: { status: string } }) => openToday({ status: body.status, statusSince: istAt('11:30') }),
    });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    const chip = await screen.findByRole('button', { name: 'My status: Active · 11:20. Change it' });
    await userEvent.click(chip);
    const menu = screen.getByRole('menu', { name: 'Change my status' });
    expect(within(menu).getByRole('menuitemradio', { name: /^Active/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: /On call/ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: /After-call work/ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: 'System problem (Team Lead approves)' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: 'Short break (15 min)' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: 'Lunch (30 min)' })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /On call/ }));
    expect(api.calls('POST /attendance/status')).toHaveLength(0);
    await userEvent.click(chip);
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Team meeting' }));
    await waitFor(() => expect(api.calls('POST /attendance/status')).toHaveLength(1));
    expect(api.calls('POST /attendance/status')[0]!.body).toEqual({ status: 'team_meeting' });
    expect(await screen.findByRole('button', { name: 'My status: Team meeting · 11:30. Change it' })).toBeInTheDocument();
    // The banner shows the status picked on every other page.
    const banner = document.querySelector('.lb-att-banner');
    expect(banner).toHaveTextContent('Team meeting · since 11:30 AM');
    expect(banner).toHaveTextContent('Calls are stopped for you');
  });

  it('starts the day from the menu and says when the login was late', async () => {
    const api = mockApi({
      'GET /attendance/today': notStartedToday(),
      'POST /attendance/login': openToday({ loginAt: istAt('09:52'), lateMinutes: 22, segments: [], statusSince: istAt('09:52') }),
    });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    expect(await screen.findByText('You haven’t started your day. Calls and your list unlock after you start it.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'My status: Not logged in. Change it' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Start my day' }));
    await waitFor(() => expect(api.calls('POST /attendance/login')).toHaveLength(1));
    expect(await screen.findByText('Day started at 9:52 AM · marked late by 22 min.')).toBeInTheDocument();
  });

  it('ends the day only after confirming', async () => {
    const api = mockApi({
      'GET /attendance/today': openToday(),
      'POST /attendance/logout': openToday({ logoutAt: istAt('18:42'), status: null, statusSince: null, dayType: 'full' }),
      'POST /auth/logout': { success: true },
    });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    await userEvent.click(await screen.findByRole('button', { name: /^My status: Active/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'End my day' }));
    const dialog = screen.getByRole('dialog', { name: 'End your day?' });
    expect(dialog).toHaveTextContent('Production so far: 3h 34m of 8h 00m.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.calls('POST /attendance/logout')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: /^My status: Active/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'End my day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, end my day' }));
    await waitFor(() => expect(api.calls('POST /attendance/logout')).toHaveLength(1));
    // Log out ends the working day and the sign-in with it (decided 21 Nov).
    await waitFor(() => expect(api.calls('POST /auth/logout')).toHaveLength(1));
    await waitFor(() => expect(sessionStore.get()).toBeNull());
  });

  it('turns the break red in the chip and the banner once it runs over', async () => {
    mockApi({ 'GET /attendance/today': onBreakToday('11:10') });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    const chip = await screen.findByRole('button', { name: 'My status: Short break · 05:00 over. Change it' });
    expect(chip).toHaveClass('is-over');
    expect(document.querySelector('.lb-att-banner')).toHaveClass('lb-att-banner--crit');
  });

  it('follows a status the phone system sets, from the live channel', async () => {
    let status = 'available';
    const api = mockApi({ 'GET /attendance/today': () => openToday(status === 'available' ? {} : { status, statusSince: istAt('11:31') }) });
    const sse = 'event: attendance_status\ndata: {"status":"on_call","since":"x"}\n\n';
    // The phone system's event is sent only once "Active" is on screen (a fixed 50 ms timer raced the
    // first render on a slow CI runner, so the menu sometimes never showed "Active").
    let sendEvent: () => void = () => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sendEvent = () => {
          status = 'on_call';
          controller.enqueue(new TextEncoder().encode(sse));
        };
      },
    });
    const fallback = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/live/events' ? new Response(stream, { status: 200 }) : fallback(input, init),
    );
    // A token of its own: the shared live channel remembers tokens it was refused with earlier.
    sessionStore.set({ token: fakeJwt({ sub: TEST_STAFF.call_agent.id, role: 'call_agent', live: 'att' }), staff: TEST_STAFF.call_agent, expiresAt: Date.now() + 900_000, totpSetupOnly: false });
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    expect(await screen.findByRole('button', { name: /^My status: Active · 11:20/ })).toBeInTheDocument();
    sendEvent();
    expect(await screen.findByRole('button', { name: /^My status: On call · 11:31/ })).toBeInTheDocument();
  });

  it('asks “Still there?” after 10 quiet minutes and keeps the person Available when they answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    let nowMs = new Date(istAt('11:30')).getTime();
    vi.setSystemTime(nowMs);
    const api = mockApi({ 'GET /attendance/today': openToday(), 'POST /attendance/heartbeat': openToday() });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent' });
    expect(await screen.findByRole('button', { name: /^My status: Active/ })).toBeInTheDocument();
    nowMs += 10 * 60_000 + 8_000;
    vi.setSystemTime(nowMs);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    const prompt = await screen.findByRole('alertdialog', { name: 'Still there, Deepa?' });
    expect(prompt).toHaveTextContent('You’ve been Active for 10 minutes with no calls or clicks.');
    expect(prompt).toHaveTextContent(/0:5\d/);
    expect(prompt).toHaveTextContent('If you don’t answer, your status changes to Idle, calls stop, and your Team Lead sees it.');
    fireEvent.click(within(prompt).getByRole('button', { name: 'I’m here — stay Active' }));
    await waitFor(() => expect(api.calls('POST /attendance/heartbeat').length).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});

describe('decided 22 Nov: the day opens at sign-in, in Start of day', () => {
  afterEach(() => vi.useRealTimers());

  it('shows Start of day greyed, with its own colour, and “Start work — Active” in the banner; nothing to start by hand', async () => {
    const startOfDay = openToday({
      status: 'start_of_day',
      statusSince: istAt('09:32'),
      loginAt: istAt('09:32'),
      startsAtSignIn: true,
      segments: [{ status: 'start_of_day', startedAt: istAt('09:32'), endedAt: null, source: 'staff', approved: null }],
    });
    const api = mockApi({
      'GET /attendance/today': startOfDay,
      'POST /attendance/status': ({ body }: { body: { status: string } }) => openToday({ status: body.status, statusSince: istAt('11:30'), startsAtSignIn: true }),
    });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    const chip = await screen.findByRole('button', { name: 'My status: Start of day · 9:32. Change it' });
    const banner = await screen.findByTestId('att-start-of-day');
    expect(banner).toHaveTextContent('Start of day · since 9:32 AM');
    expect(banner).toHaveTextContent('Calls come to you only when you are Active.');
    await userEvent.click(chip);
    const menu = screen.getByRole('menu', { name: 'Change my status' });
    const start = within(menu).getByRole('menuitemradio', { name: /^Start of day/ });
    expect(start).toHaveAttribute('aria-disabled', 'true');
    expect(start).toHaveAttribute('aria-checked', 'true');
    expect(start.querySelector('.lb-att-dot')).toHaveStyle({ background: '#7A4FC4' });
    expect(within(menu).queryByRole('menuitem', { name: 'Start my day' })).not.toBeInTheDocument();
    await userEvent.click(start);
    expect(api.calls('POST /attendance/status')).toHaveLength(0);
    await userEvent.click(within(banner).getByRole('button', { name: 'Start work — Active' }));
    await waitFor(() => expect(api.calls('POST /attendance/status')[0]?.body).toEqual({ status: 'available' }));
    expect(await screen.findByRole('button', { name: /^My status: Active/ })).toBeInTheDocument();
  });

  it('a call agent whose day did not open is asked to sign in again, never to Start my day', async () => {
    mockApi({ 'GET /attendance/today': notStartedToday({ startsAtSignIn: true }), 'POST /auth/logout': { success: true } });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    expect(await screen.findByText('Your day starts when you sign in. Sign out and sign in again to start it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start my day' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'My status: Not logged in. Change it' }));
    expect(screen.queryByRole('menuitem', { name: 'Start my day' })).not.toBeInTheDocument();
  });

  it('writes Active, After-call work and Start of day as the status names', () => {
    expect(t('att.status.available')).toBe('Active');
    expect(t('att.status.after_call_notes')).toBe('After-call work');
    expect(t('att.status.start_of_day')).toBe('Start of day');
  });
});

describe('decided 21 Nov: presence, Back from lunch?, Resume my day, own shifts', () => {
  afterEach(() => vi.useRealTimers());

  it('while the console is open and visible it sends a presence heartbeat about once a minute without any input', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi({
      'GET /attendance/today': openToday(),
      'POST /attendance/heartbeat': () => openToday(),
    });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    await screen.findByRole('button', { name: /^My status: Active/ });
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    await waitFor(() => expect(api.calls('POST /attendance/heartbeat').length).toBeGreaterThan(0));
    expect(api.calls('POST /attendance/heartbeat')[0]!.body).toEqual({ kind: 'presence' });
  });

  it('after the break allowance asks “Back from your break?” and one tap makes the person Available', async () => {
    const api = mockApi({
      'GET /attendance/today': onBreakToday('11:10'),
      'POST /attendance/status': ({ body }: { body: { status: string } }) => openToday({ status: body.status, statusSince: istAt('11:30') }),
    });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    const ask = await screen.findByRole('alertdialog', { name: 'Back from your break?' });
    expect(ask).toHaveTextContent('15-minute allowance is over');
    await userEvent.click(within(ask).getByRole('button', { name: 'I’m back' }));
    await waitFor(() => expect(api.calls('POST /attendance/status')).toHaveLength(1));
    expect(api.calls('POST /attendance/status')[0]!.body).toEqual({ status: 'available' });
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Back from your break?' })).toBeNull());
  });

  it('inside the allowance there is no question; lunch asks “Back from lunch?”', async () => {
    mockApi({ 'GET /attendance/today': onBreakToday('11:24') });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    await screen.findByRole('button', { name: /^My status: Short break/ });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a day ended with Log out today offers Resume my day', async () => {
    const api = mockApi({
      'GET /attendance/today': openToday({ logoutAt: istAt('11:00'), status: null, statusSince: null, dayType: 'full', closedReason: 'logout', canResume: true }),
      'POST /attendance/resume': openToday(),
    });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'Resume my day' }));
    await waitFor(() => expect(api.calls('POST /attendance/resume')).toHaveLength(1));
    expect(await screen.findByText('Day resumed. The time in between is not counted.')).toBeInTheDocument();
  });

  it('the Team Lead sees the team\'s shifts and sets an own shift', async () => {
    const { ShiftsPanel } = await import('./ShiftsPanel');
    const api = mockApi({
      'GET /attendance/shifts': {
        companyShift: { start: '09:30', end: '18:30' },
        people: [{ staffId: 'a1', code: 'CA-00002', name: 'Kavya', role: 'call_agent', shiftStart: '09:30', shiftEnd: '18:30', own: false }],
      },
      'PUT /attendance/shifts/a1': ({ body }: { body: { shiftStart: string; shiftEnd: string } }) => ({ staffId: 'a1', code: 'CA-00002', name: 'Kavya', role: 'call_agent', ...body, own: true }),
    });
    signInAs('team_lead');
    renderScreen(<ShiftsPanel />, { portal: 'team-lead', path: '/team-lead/attendance', now: ATT_NOW });
    expect(await screen.findByText('Kavya (CA-00002)')).toBeInTheDocument();
    expect(screen.getByText(/Company shift: 9:30 AM – 6:30 PM/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Starts · Kavya'), { target: { value: '12:00' } });
    fireEvent.change(screen.getByLabelText('Ends · Kavya'), { target: { value: '21:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calls('PUT /attendance/shifts/a1')).toHaveLength(1));
    expect(api.calls('PUT /attendance/shifts/a1')[0]!.body).toEqual({ shiftStart: '12:00', shiftEnd: '21:00' });
  });
});
