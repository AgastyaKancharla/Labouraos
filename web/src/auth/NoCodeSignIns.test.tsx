import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../test/utils';
import { NoCodeSignIns } from './NoCodeSignIns';

describe('Login codes: signed in again without a code (21 Nov)', () => {
  it('lists today\'s alerts for the Team Lead', async () => {
    mockApi({
      'GET /login-codes/without-code': [
        { id: 'n1', title: 'Kavya (CA-00002) signed in again without a code — ended the earlier session', body: 'A login code was given earlier today on the same device.', at: '2026-11-24T05:00:00.000Z' },
      ],
    });
    signInAs('team_lead');
    renderScreen(<NoCodeSignIns />, { portal: 'team-lead', path: '/team-lead/login-codes' });
    expect(await screen.findByText(/Kavya \(CA-00002\) signed in again without a code — ended the earlier session/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Signed in again without a code today' })).toBeInTheDocument();
  });

  it('shows nothing when there are none', async () => {
    const api = mockApi({ 'GET /login-codes/without-code': [] });
    signInAs('team_lead');
    const { container } = renderScreen(<NoCodeSignIns />, { portal: 'team-lead', path: '/team-lead/login-codes' });
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls('GET /login-codes/without-code').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('Signed in again without a code');
  });
});
