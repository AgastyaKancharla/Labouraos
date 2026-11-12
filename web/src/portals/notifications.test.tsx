import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HomeNotifications } from '../components/HomeNotifications';
import { TopBar } from '../components/TopBar';
import { sessionStore } from '../auth/session';
import { TEST_STAFF, fakeJwt, mockApi, renderScreen, signInAs } from '../test/utils';
import { toBellItems, type NotificationBellData } from './notifications';

const bell: NotificationBellData = {
  openCount: 2,
  unseenCount: 1,
  asOf: '2026-11-16T06:00:00.000Z',
  latest: [
    {
      id: 'n1',
      kind: 'leave_request',
      title: 'Deepa Nair (CA-0042) asks for 1 day of casual leave',
      body: 'Sent to the Team Lead',
      link: '/team-lead/requests?kind=leave&id=r1',
      subjectType: 'leave_request',
      subjectId: 'r1',
      status: 'open',
      seen: false,
      createdAt: '2026-11-16T05:00:00.000Z',
      seenAt: null,
      clearedAt: null,
      clearedReason: null,
      clearedBy: null,
    },
    {
      id: 'n2',
      kind: 'break_overrun',
      title: 'Kiran Kumar (CA-0043): short break over 15 minutes',
      body: null,
      link: '/team-lead/attendance/live',
      subjectType: 'attendance_segment',
      subjectId: 's1',
      status: 'open',
      seen: true,
      createdAt: '2026-11-16T04:00:00.000Z',
      seenAt: '2026-11-16T04:10:00.000Z',
      clearedAt: null,
      clearedReason: null,
      clearedBy: null,
    },
  ],
  doneToday: [
    {
      id: 'n3',
      kind: 'correction_request',
      title: 'Asha (CA-0044) asks for a correction on 2026-11-15',
      body: 'Sent to the Team Lead',
      link: '/team-lead/requests?kind=correction&id=r2',
      subjectType: 'attendance_correction',
      subjectId: 'r2',
      status: 'cleared',
      seen: true,
      createdAt: '2026-11-16T03:00:00.000Z',
      seenAt: null,
      clearedAt: '2026-11-16T03:30:00.000Z',
      clearedReason: 'request_approved',
      clearedBy: { id: 'staff-tl', code: 'TL-0003', name: 'Ravi Shankar', role: 'team_lead' },
    },
  ],
};

describe('toBellItems', () => {
  it('lists open items first, then today’s done ones with who did them', () => {
    const items = toBellItems(bell, (name) => `Done by ${name}`);
    expect(items.map((i) => [i.id, i.state])).toEqual([
      ['n1', 'open'],
      ['n2', 'open'],
      ['n3', 'cleared'],
    ]);
    expect(items[0].to).toBe('/team-lead/requests?kind=leave&id=r1');
    expect(items[2].detail).toBe('Done by Ravi Shankar');
  });

  it('is empty before the first answer', () => {
    expect(toBellItems(undefined, (n) => n)).toEqual([]);
  });
});

describe('TopBar bell', () => {
  it('shows the open count from GET /notifications/bell and marks them seen when opened', async () => {
    const api = mockApi({ 'GET /notifications/bell': bell, 'POST /notifications/seen': { seen: 1, cleared: 0 } });
    signInAs('team_lead');
    renderScreen(<TopBar title="Home" />, { portal: 'team-lead', path: '/team-lead' });

    const button = await screen.findByRole('button', { name: 'Notifications, 2 new' });
    await userEvent.click(button);
    const link = screen.getByRole('link', { name: /asks for 1 day of casual leave/ });
    expect(link).toHaveAttribute('href', '/team-lead/requests?kind=leave&id=r1');
    expect(screen.getByText('Cleared by itself when Ravi Shankar did the work')).toBeInTheDocument();
    expect(screen.getByText('Done today · cleared by themselves')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('POST /notifications/seen')).toHaveLength(1));
  });

  it('does not ask for notifications when nobody is signed in', async () => {
    const api = mockApi({ 'GET /notifications/bell': bell });
    renderScreen(<TopBar title="Home" />, { portal: 'team-lead', path: '/team-lead' });
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(api.calls('GET /notifications/bell')).toHaveLength(0);
  });

  it('reloads at once when the live channel says a notification changed', async () => {
    let bellCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost');
        if (url.pathname === '/notifications/bell') {
          bellCalls += 1;
          const body = { ...bell, openCount: bellCalls === 1 ? 2 : 3 };
          return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/live/events') {
          // Sent once the first bell answer is in, so the reload is the event's doing.
          await waitFor(() => expect(bellCalls).toBe(1));
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('event: notification\nid: 1\ndata: {"kind":"leave_request","change":"opened"}\n\n'),
              );
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ statusCode: 501 }), { status: 501 });
      }),
    );
    // A token of its own: the live channel ignores a token an earlier test's 501 blocked.
    sessionStore.set({
      token: fakeJwt({ sub: TEST_STAFF.team_lead.id, role: 'team_lead', test: 'live-bell' }),
      staff: TEST_STAFF.team_lead,
      expiresAt: Date.now() + 15 * 60 * 1000,
      totpSetupOnly: false,
    });
    renderScreen(<TopBar title="Home" />, { portal: 'team-lead', path: '/team-lead' });
    expect(await screen.findByRole('button', { name: 'Notifications, 3 new' })).toBeInTheDocument();
    expect(bellCalls).toBe(2);
  });
});

describe('Home notifications block (Main, MG-Home, T-Home, FN-Home)', () => {
  it('lists the open notifications, then "Done today · cleared by themselves", then See all', async () => {
    mockApi({ 'GET /notifications/bell': bell });
    signInAs('team_lead');
    renderScreen(<HomeNotifications />, { portal: 'team-lead', path: '/team-lead' });

    const block = await screen.findByTestId('home-notifications');
    expect(screen.getByRole('heading', { name: 'Notifications · 2 new' })).toBeInTheDocument();
    const links = within(block).getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/team-lead/requests?kind=leave&id=r1');
    expect(within(block).getByText('Done today · cleared by themselves')).toBeInTheDocument();
    expect(within(block).getByText('Cleared by itself when Ravi Shankar did the work')).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: 'See all notifications →' })).toHaveAttribute('href', '/team-lead/notifications');
  });

  it('says so when nothing is waiting, and names no one for an item that cleared with no person', async () => {
    mockApi({
      'GET /notifications/bell': {
        ...bell,
        openCount: 0,
        latest: [],
        doneToday: [{ ...bell.doneToday[0], clearedBy: null }],
      },
    });
    signInAs('finance');
    renderScreen(<HomeNotifications />, { portal: 'finance', path: '/finance' });
    const block = await screen.findByTestId('home-notifications');
    expect(within(block).getByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(within(block).getByText('Cleared by itself when the work was done')).toBeInTheDocument();
  });
});
