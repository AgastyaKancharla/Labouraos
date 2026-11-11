import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import ReferralSaved from './index';

describe('Referral partner saved (CA15b)', () => {
  it('shows the RF- ID, the four link steps and resends the link', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /screens/call-registration/referrals/ref-1': {
        id: 'ref-1', code: 'RF-00043', name: 'Raju Kumar', phone: '******0011', phoneVerifiedAt: '2026-11-11T06:40:00Z', type: 'individual', language: 'kn',
        registrationLink: { sentAt: '2026-11-11T06:41:00Z', expiresAt: '2026-11-13T06:41:00Z', live: true },
      },
      'GET /referrals/ref-1/registration-status': {
        referralId: 'ref-1', currentStep: 'terms',
        steps: { terms: { state: 'not_started', time: null }, selfie: { state: 'stuck', time: null }, id: { state: 'not_started', time: null }, upi: { state: 'not_started', time: null } },
      },
      'POST /referrals/ref-1/terms-links': { success: true },
    });
    signInAs('call_agent');
    renderScreen(<ReferralSaved />, { portal: 'call-agent', path: '/call-agent/register/referral/saved?id=ref-1' });
    expect(await screen.findByText(/Partner ID RF-00043 sent to Raju by SMS/)).toBeInTheDocument();
    expect(await screen.findByText('Link sent 12:11 · waiting')).toBeInTheDocument();
    expect(screen.getByText('Aadhaar, or PAN / driving licence / voter ID')).toBeInTheDocument();
    expect(screen.getByText('Checked against the name on the ID')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resend link' }));
    await waitFor(() => expect(api.calls('POST /referrals/ref-1/terms-links')[0]?.body).toEqual({ language: 'kn' }));
  });
});
