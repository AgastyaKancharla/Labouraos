import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import { listPage, partner } from '../_lists/fixtures';
import MyPartners from './index';

const path = { portal: 'call-agent' as const, path: '/call-agent/my/referral-partners' };

const rows = () => [
  partner(),
  partner({ id: 'rf2', code: 'RF-00302', name: 'Waiting Partner', row: { status: 'waiting_tl', action: null, vacancyId: null, waiting: true, done: false, group: 'waiting_tl' } }),
  partner({ id: 'rf3', code: 'RF-00303', name: 'Shop Partner', partnerType: 'business', locality: 'Koramangala', referred: 4, row: { status: 'all_set', action: null, vacancyId: null, waiting: false, done: true, group: 'done' } }),
];

describe('My referral partners (call agent console lists, 23 Nov)', () => {
  it('shows bold name, Individual / Business · area, the status line and how many they referred', async () => {
    mockApi({ 'GET /call-work/my/referrals': listPage(rows()) });
    signInAs('call_agent');
    renderScreen(<MyPartners />, path);
    const first = await screen.findByTestId('partner-row-RF-00301');
    expect(within(first).getByText('Antony George').tagName).toBe('B');
    expect(within(first).getByText('Individual · HSR Layout')).toBeInTheDocument();
    expect(within(first).getByTestId('row-status')).toHaveTextContent('Partner terms not accepted');
    expect(within(first).getByText('0 referred')).toBeInTheDocument();
    expect(within(first).getByRole('link')).toHaveAttribute('href', '/call-agent/people/RF-00301');
    const shop = screen.getByTestId('partner-row-RF-00303');
    expect(within(shop).getByText('Business · Koramangala')).toBeInTheDocument();
    expect(within(shop).getByText('4 referred')).toBeInTheDocument();
    expect(within(shop).getByTestId('row-done')).toBeInTheDocument();
    expect(within(screen.getByTestId('partner-row-RF-00302')).getByTestId('row-waiting')).toBeInTheDocument();
    expect(within(screen.getByTestId('partner-row-RF-00302')).queryByRole('button')).toBeNull();
  });

  it('Send partner terms link works in place', async () => {
    const api = mockApi({ 'GET /call-work/my/referrals': listPage(rows()), 'POST /referrals/rf1/terms-links': { smsSent: true } });
    signInAs('call_agent');
    renderScreen(<MyPartners />, path);
    const row = await screen.findByTestId('partner-row-RF-00301');
    await userEvent.click(within(row).getByRole('button', { name: 'Send partner terms link' }));
    await waitFor(() => expect(api.calls('POST /referrals/rf1/terms-links')).toHaveLength(1));
    expect(await within(row).findByRole('button', { name: 'Sent ✓' })).toBeDisabled();
  });
});
