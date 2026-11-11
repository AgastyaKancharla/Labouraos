import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import WithdrawConsent from './index';

const seeker = { id: 'js-uuid', code: 'JS-00881', name: 'Ramesh Kumar', gender: 'male', paymentReceivedAt: '2026-11-01T05:00:00Z' };

describe('Withdraw consent (CA12)', () => {
  it('withdraws on an answered call, warns that the refund ends, and sends the call record', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /job-seekers/JS-00881': seeker,
      'GET /consent/withdrawal-eligibility': { eligible: true, callRecordId: 'call-1' },
      'POST /consent/withdraw': { withdrawn: true, purposes: ['call_recording'] },
    });
    signInAs('call_agent');
    renderScreen(<WithdrawConsent />, { portal: 'call-agent', path: '/call-agent/consent/withdraw?jobSeeker=JS-00881' });
    expect(await screen.findByRole('heading', { name: 'Ramesh asked to withdraw consent' })).toBeInTheDocument();
    expect(await screen.findByText(/Allowed: you had an answered, recorded call with Ramesh/)).toBeInTheDocument();
    expect(api.calls('GET /consent/withdrawal-eligibility')[0].query.get('jobSeekerId')).toBe('js-uuid');
    await user.click(screen.getByLabelText('Call recording'));
    expect(screen.getByText(/because they have paid, ends the ₹499 refund/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Withdraw and send SMS' }));
    await waitFor(() => expect(api.calls('POST /consent/withdraw')[0]?.body).toEqual({ jobSeekerId: 'js-uuid', purposes: ['call_recording'], callRecordId: 'call-1' }));
  });

  it('refuses without an answered recent call', async () => {
    mockApi({ 'GET /job-seekers/JS-00881': seeker, 'GET /consent/withdrawal-eligibility': { eligible: false, callRecordId: null } });
    signInAs('call_agent');
    renderScreen(<WithdrawConsent />, { portal: 'call-agent', path: '/call-agent/consent/withdraw?jobSeeker=JS-00881' });
    expect(await screen.findByText('Not allowed right now.')).toBeInTheDocument();
    expect(screen.getByLabelText('Call recording')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Withdraw and send SMS' })).toBeDisabled();
  });
});
