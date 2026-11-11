import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import OtherPayer from './index';

const done = { state: 'done', time: null, reason: null };
const status = (paymentReached: boolean) => ({
  id: 'js-uuid', code: 'JS-01042', name: 'Kavya Reddy', gender: 'female', stage: 'in_progress', nextStep: 'payment', trades: [], phone: '******2345',
  steps: { phone: done, consent: done, selfie: done, idCheck: paymentReached ? done : { state: 'in_progress' }, payment: { state: 'in_progress' } },
});

describe('Send payment link to another number (CA08e)', () => {
  it('sends the payer’s number and who they are', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /screens/call-registration/job-seekers/js-uuid': status(true),
      'POST /job-seekers/js-uuid/payment-only-link': { success: true, expiresAt: '2026-11-11T05:45:00Z' },
    });
    signInAs('call_agent');
    renderScreen(<OtherPayer />, { portal: 'call-agent', path: '/call-agent/register/job-seeker/js-uuid/other-payer', route: '/call-agent/register/job-seeker/:id/other-payer' });
    expect(await screen.findByText(/someone else pays for Kavya/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Their mobile number/), '9886041207');
    await user.selectOptions(screen.getByLabelText('Who is it?'), 'brother');
    await user.click(screen.getByRole('button', { name: 'Send payment link' }));
    await waitFor(() => expect(api.calls('POST /job-seekers/js-uuid/payment-only-link')[0]?.body).toEqual({ phone: '9886041207', relation: 'brother' }));
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('is not allowed before consent, selfie and ID are finished', async () => {
    mockApi({ 'GET /screens/call-registration/job-seekers/js-uuid': status(false) });
    signInAs('call_agent');
    renderScreen(<OtherPayer />, { portal: 'call-agent', path: '/call-agent/register/job-seeker/js-uuid/other-payer', route: '/call-agent/register/job-seeker/:id/other-payer' });
    expect(await screen.findByText(/Not yet: consent, selfie and ID must be finished first/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send payment link' })).toBeDisabled();
  });
});
