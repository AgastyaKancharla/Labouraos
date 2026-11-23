import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { business, listPage } from '../_lists/fixtures';
import MyBusinesses from './index';

const path = { portal: 'call-agent' as const, path: '/call-agent/my/businesses' };

const rows = () => [
  business(),
  business({ id: 'b2', code: 'BZ-00202', name: 'Confirm Hotel', row: { status: 'vacancy_to_confirm', action: 'confirm_vacancy', vacancyId: 'v2', waiting: false, done: false, group: 'needs_action' } }),
  business({ id: 'b3', code: 'BZ-00203', name: 'Draft Mess', row: { status: 'vacancy_to_send', action: 'confirm_vacancy', vacancyId: 'v3', waiting: false, done: false, group: 'needs_action' } }),
  business({ id: 'b4', code: 'BZ-00204', name: 'Empty Cafe', row: { status: 'no_shifts', action: 'add_vacancy', vacancyId: null, waiting: false, done: false, group: 'needs_action' } }),
  business({ id: 'b5', code: 'BZ-00205', name: 'Checking Bakery', row: { status: 'waiting_tl', action: null, vacancyId: null, waiting: true, done: false, group: 'waiting_tl' } }),
  business({
    id: 'b6', code: 'BZ-00206', name: 'Busy Restaurant', businessType: 'restaurant', openVacancies: 3, candidatesShown: 7, interviewsToday: 2,
    row: { status: 'candidates_shown', action: null, vacancyId: null, waiting: false, done: false, group: 'active' },
  }),
  business({ id: 'b7', code: 'BZ-00207', name: 'Good Store', row: { status: 'all_good', action: null, vacancyId: null, waiting: false, done: true, group: 'done' } }),
];

describe('My businesses (call agent console lists, 23 Nov)', () => {
  it('shows bold name, Type · area, the status line and the numbers; Waiting, Done or one button', async () => {
    mockApi({ 'GET /call-work/my/businesses': listPage(rows()) });
    signInAs('call_agent');
    renderScreen(<MyBusinesses />, path);
    const busy = await screen.findByTestId('business-row-BZ-00206');
    expect(within(busy).getByText('Busy Restaurant').tagName).toBe('B');
    expect(within(busy).getByTestId('row-status')).toHaveTextContent('Candidates shown');
    expect(within(busy).getByText('3 vacancies · 7 candidates shown · 2 interviews today')).toBeInTheDocument();
    expect(within(busy).queryByRole('button')).toBeNull();
    expect(within(busy).getByRole('link')).toHaveAttribute('href', '/call-agent/people/BZ-00206');
    const first = screen.getByTestId('business-row-BZ-00201');
    expect(within(first).getByText(/· Bellandur$/)).toBeInTheDocument();
    expect(within(first).getByTestId('row-status')).toHaveTextContent('Agreement not signed · link not sent');
    expect(within(screen.getByTestId('business-row-BZ-00205')).getByTestId('row-waiting')).toBeInTheDocument();
    expect(within(screen.getByTestId('business-row-BZ-00207')).getByTestId('row-done')).toBeInTheDocument();
    // Draft: Finish vacancy opens CA09 with the draft; no shifts / no vacancy: Add vacancy for this business.
    expect(within(screen.getByTestId('business-row-BZ-00203')).getByRole('link', { name: 'Finish vacancy' })).toHaveAttribute('href', '/call-agent/vacancies/new?draft=v3');
    expect(within(screen.getByTestId('business-row-BZ-00204')).getByRole('link', { name: 'Add vacancy' })).toHaveAttribute('href', '/call-agent/vacancies/new?business=BZ-00204');
    expect(document.body.textContent).not.toMatch(/₹/);
  });

  it('Send agreement link and Resend vacancy link work in place', async () => {
    const api = mockApi({
      'GET /call-work/my/businesses': listPage(rows()),
      'POST /businesses/b1/agreement-links': { smsSent: true },
      'POST /vacancies/v2/confirmation-link': { ok: true },
    });
    signInAs('call_agent');
    renderScreen(<MyBusinesses />, path);
    await userEvent.click(within(await screen.findByTestId('business-row-BZ-00201')).getByRole('button', { name: 'Send agreement link' }));
    await waitFor(() => expect(api.calls('POST /businesses/b1/agreement-links')).toHaveLength(1));
    await userEvent.click(within(screen.getByTestId('business-row-BZ-00202')).getByRole('button', { name: 'Resend vacancy link' }));
    await waitFor(() => expect(api.calls('POST /vacancies/v2/confirmation-link')).toHaveLength(1));
  });
});
