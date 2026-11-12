import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TopBar } from '../components/TopBar';
import { mockApi, renderScreen, signInAs } from '../test/utils';
import { ATT_NOW, balanceFixture, istAt, monthFixture, notStartedToday, openToday } from './fixtures';
import Attendance from '../screens/call-agent/CA14b-AttendanceActive';

const monthRoutes = { 'GET /attendance/month': monthFixture(), 'GET /attendance/leave/balance': balanceFixture };

describe('header status menu (Team Lead, Manager, Finance)', () => {
  it('puts the same control in the page header with the office statuses', async () => {
    const api = mockApi({
      'GET /attendance/today': openToday({ segments: [] }),
      'POST /attendance/status': openToday({ status: 'training', statusSince: istAt('11:30'), segments: [] }),
      'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: ATT_NOW.toISOString() },
    });
    signInAs('team_lead');
    renderScreen(<TopBar title="Home" />, { portal: 'team-lead', path: '/team-lead', now: ATT_NOW });
    await userEvent.click(await screen.findByRole('button', { name: 'My status: Available · 11:20. Change it' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitemradio', { name: /On call/ })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: 'One-to-one' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: 'System problem (needs approval)' })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Training' }));
    await waitFor(() => expect(api.calls('POST /attendance/status')[0]?.body).toEqual({ status: 'training' }));
  });

  it('is not shown to the CEO, who does not mark attendance', async () => {
    const api = mockApi({ 'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: ATT_NOW.toISOString() } });
    signInAs('ceo');
    renderScreen(<TopBar title="Home" />, { portal: 'ceo', path: '/ceo', now: ATT_NOW });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /My status/ })).not.toBeInTheDocument();
    expect(api.calls('GET /attendance/today')).toHaveLength(0);
  });
});

describe('Own attendance for a Team Lead, Manager or Finance (same screen)', () => {
  it('uses their statuses and wording', async () => {
    mockApi({ 'GET /attendance/today': openToday({ status: 'one_to_one', statusSince: istAt('11:00') }), 'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: ATT_NOW.toISOString() } });
    signInAs('manager');
    renderScreen(<Attendance />, { portal: 'manager', path: '/manager/my-attendance', now: ATT_NOW });
    expect(await screen.findByText('● One-to-one · since 11:00 AM')).toBeInTheDocument();
    expect(screen.getByText('Counts as production')).toBeInTheDocument();
    expect(screen.getByText('Includes meetings and training')).toBeInTheDocument();
    expect(screen.getByText('Idle is set automatically.')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Change my status' });
    expect(within(select).getByRole('option', { name: 'System problem (needs approval)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My attendance, leave & payslips →' })).toHaveAttribute('href', '/manager/my-attendance/month');
  });

  it('a Finance person starts their day from the same screen', async () => {
    const api = mockApi({ 'GET /attendance/today': notStartedToday(), ...monthRoutes, 'POST /attendance/login': openToday(), 'GET /notifications/bell': { openCount: 0, unseenCount: 0, latest: [], doneToday: [], asOf: ATT_NOW.toISOString() } });
    signInAs('finance');
    renderScreen(<Attendance />, { portal: 'finance', path: '/finance/my-attendance', now: ATT_NOW });
    expect(await screen.findByText('9:30 AM – 6:30 PM')).toBeInTheDocument();
    expect(document.querySelector('.lb-att-hero .lb-att-muted')).toHaveTextContent(/Your shift today: 9:30 AM – 6:30 PM\. Start your day to begin your attendance\.$/);
    const start = screen.getAllByRole('button', { name: 'Start my day' }).find((b) => b.classList.contains('lb-att-cta'))!;
    await userEvent.click(start);
    await waitFor(() => expect(api.calls('POST /attendance/login')).toHaveLength(1));
  });
});
