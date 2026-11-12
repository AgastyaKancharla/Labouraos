import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ATT_NOW, balanceFixture, monthFixture, openToday, requestsFixture } from '../../../attendance/fixtures';
import { apiError, mockApi, renderScreen, signInAs } from '../../../test/utils';
import MyAttendance from './index';

const path = { portal: 'call-agent' as const, path: '/call-agent/attendance/history', now: ATT_NOW };

describe('My attendance (CA14e)', () => {
  it('shows the month: production against what was needed, make-up owed, leave left, my requests and each day', async () => {
    const api = mockApi({
      'GET /attendance/today': openToday(),
      'GET /attendance/month': monthFixture(),
      'GET /attendance/leave/balance': balanceFixture,
      'GET /attendance/requests/mine': requestsFixture,
    });
    signInAs('call_agent');
    renderScreen(<MyAttendance />, path);
    expect(await screen.findByRole('heading', { name: 'My attendance · November' })).toBeInTheDocument();
    expect(api.calls('GET /attendance/month')[0]!.query.get('month')).toBe('2026-11');
    expect(await screen.findByText('36h 09m')).toBeInTheDocument();
    // 5 days expected so far (3 worked + 1 half + today) × 8h.
    expect(screen.getByText('of 40h 00m needed so far (5 working days)')).toBeInTheDocument();
    expect(screen.getByText('0h 40m')).toHaveStyle({ color: 'var(--tomato)' });
    expect(screen.getByText('short 1h 20m · made up 0h 40m · deducted if not made up by 30 Nov')).toBeInTheDocument();
    expect(await screen.findByText('3 left')).toBeInTheDocument();

    expect(await screen.findByText('Emergency leave · Fri 13 Nov')).toBeInTheDocument();
    expect(screen.getByText('Waiting for your Team Lead')).toHaveClass('ta');
    expect(screen.getByText('Correction · Fri 6 Nov, 9:30–9:52')).toBeInTheDocument();
    expect(screen.getByText('Approved by Ravi')).toHaveClass('tg');
    expect(screen.getByText('Casual leave · Thu 5 Nov')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Each day this month' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(6);
    expect(within(rows[0]!).getByText('Mon 9 Nov')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('in progress')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Today')).toHaveClass('tb');
    expect(within(rows[2]!).getByText('Fri 6 Nov')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('9:52')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('6:31')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Late 22m · 40m short')).toHaveClass('ta');
    expect(within(rows[3]!).getByText('Casual leave (approved)')).toHaveClass('tc');
    expect(within(rows[4]!).getByText('Half day')).toHaveClass('tr');
    expect(within(rows[5]!).getByText('Full day · +40m make-up')).toHaveClass('tg');
    expect(within(rows[1]!).getByText('Full day')).toHaveClass('tg');

    expect(screen.getByRole('link', { name: 'Request leave' })).toHaveAttribute('href', '/call-agent/attendance/leave');
    expect(screen.getByRole('link', { name: 'Request a correction' })).toHaveAttribute('href', '/call-agent/attendance/correction');
    expect(screen.getByRole('link', { name: 'Payslips' })).toHaveAttribute('href', '/call-agent/attendance/payslip');
    expect(screen.getByText(/8 production hours = a full day; under 4\.5 hours = a half day/)).toBeInTheDocument();
  });

  it('goes back a month, never into the future', async () => {
    const api = mockApi({
      'GET /attendance/today': openToday(),
      'GET /attendance/month': ({ url }: { url: URL }) => monthFixture({ month: url.searchParams.get('month')!, days: [] }),
      'GET /attendance/leave/balance': balanceFixture,
      'GET /attendance/requests/mine': [],
    });
    signInAs('call_agent');
    renderScreen(<MyAttendance />, path);
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeDisabled();
    expect(await screen.findByText('No leave or correction requests yet.')).toBeInTheDocument();
    expect(await screen.findByText('No days recorded this month yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('heading', { name: 'My attendance · October' })).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET /attendance/month').map((c) => c.query.get('month'))).toContain('2026-10'));
  });

  it('shows an error with a retry', async () => {
    mockApi({
      'GET /attendance/today': openToday(),
      'GET /attendance/month': apiError(500, 'Internal server error'),
      'GET /attendance/leave/balance': balanceFixture,
      'GET /attendance/requests/mine': [],
    });
    signInAs('call_agent');
    renderScreen(<MyAttendance />, path);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
