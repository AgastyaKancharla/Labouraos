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
    expect(menuStatuses('agent')).toEqual(['available', 'on_call', 'after_call_notes', 'team_meeting', 'training', 'one_to_one', 'system_problem', 'short_break', 'lunch']);
    expect(menuStatuses('office')).toEqual(['available', 'team_meeting', 'training', 'one_to_one', 'system_problem', 'short_break', 'lunch']);
    expect(pickableStatuses('agent')).not.toContain('on_call');
    expect(pickableStatuses('agent')).not.toContain('after_call_notes');
    expect(pickableStatuses('agent')).not.toContain('idle');
  });

  it('writes the chip as the designs do, and turns a break red once it runs over', () => {
    const now = new Date(istAt('11:30')).getTime();
    expect(chipText(t, 'agent', openToday(), 'available', now)).toMatchObject({ text: 'Available · 11:20', over: false });
    const left = chipText(t, 'agent', onBreakToday('11:24'), 'short_break', new Date(istAt('11:30')).getTime() + 20_000);
    expect(left).toMatchObject({ text: 'Short break · 08:40 left', over: false });
    const over = chipText(t, 'agent', onBreakToday('11:10'), 'short_break', new Date(istAt('11:30')).getTime());
    expect(over).toMatchObject({ text: 'Short break · 05:00 over', over: true, dot: '#BB232B' });
    expect(chipText(t, 'agent', notStartedToday(), null, now).text).toBe('Not logged in');
    expect(chipText(t, 'office', openToday({ status: 'one_to_one', statusSince: istAt('11:00') }), 'one_to_one', now).text).toBe('One-to-one · 11:00');
  });

  it('asks “Still there?” after 10 quiet minutes while Available, and gives one minute', () => {
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
    const chip = await screen.findByRole('button', { name: 'My status: Available · 11:20. Change it' });
    await userEvent.click(chip);
    const menu = screen.getByRole('menu', { name: 'Change my status' });
    expect(within(menu).getByRole('menuitemradio', { name: /^Available/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: /On call/ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: /After-call notes/ })).toHaveAttribute('aria-disabled', 'true');
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
    });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    await userEvent.click(await screen.findByRole('button', { name: /^My status: Available/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'End my day' }));
    const dialog = screen.getByRole('dialog', { name: 'End your day?' });
    expect(dialog).toHaveTextContent('Production so far: 3h 34m of 8h 00m.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.calls('POST /attendance/logout')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: /^My status: Available/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'End my day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, end my day' }));
    await waitFor(() => expect(api.calls('POST /attendance/logout')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: 'My status: Day ended. Change it' })).toBeInTheDocument();
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
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          status = 'on_call';
          controller.enqueue(new TextEncoder().encode(sse));
        }, 50);
      },
    });
    const fallback = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/live/events' ? new Response(stream, { status: 200 }) : fallback(input, init),
    );
    // A token of its own: the shared live channel remembers tokens it was refused with earlier.
    sessionStore.set({ token: fakeJwt({ sub: TEST_STAFF.call_agent.id, role: 'call_agent', live: 'att' }), staff: TEST_STAFF.call_agent, expiresAt: Date.now() + 900_000, totpSetupOnly: false });
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent', now: ATT_NOW });
    expect(await screen.findByRole('button', { name: /^My status: Available · 11:20/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^My status: On call · 11:31/ })).toBeInTheDocument();
  });

  it('asks “Still there?” after 10 quiet minutes and keeps the person Available when they answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    let nowMs = new Date(istAt('11:30')).getTime();
    vi.setSystemTime(nowMs);
    const api = mockApi({ 'GET /attendance/today': openToday(), 'POST /attendance/heartbeat': openToday() });
    signInAs('call_agent');
    renderScreen(<Blank />, { portal: 'call-agent', path: '/call-agent' });
    expect(await screen.findByRole('button', { name: /^My status: Available/ })).toBeInTheDocument();
    nowMs += 10 * 60_000 + 8_000;
    vi.setSystemTime(nowMs);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    const prompt = await screen.findByRole('alertdialog', { name: 'Still there, Deepa?' });
    expect(prompt).toHaveTextContent('You’ve been Available for 10 minutes with no calls or clicks.');
    expect(prompt).toHaveTextContent(/0:5\d/);
    expect(prompt).toHaveTextContent('If you don’t answer, your status changes to Idle, calls stop, and your Team Lead sees it.');
    fireEvent.click(within(prompt).getByRole('button', { name: 'I’m here — stay Available' }));
    await waitFor(() => expect(api.calls('POST /attendance/heartbeat').length).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
