import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import RegisterReferral from './index';
import { EMPTY_REFERRAL, referralBody, type ReferralForm } from './payload';

const form: ReferralForm = {
  ...EMPTY_REFERRAL,
  name: 'Raju Kumar',
  mobile: '9945670011',
  language: 'kn',
  individualRole: 'shop_owner',
  place: { area: 'Madiwala', pincode: '560068', latitude: null, longitude: null },
  heardFrom: 'field_visit',
};
const routes = (overrides: Record<string, unknown> = {}) => ({
  'GET /screens/call-registration/options': { city: 'Bengaluru', areas: [{ name: 'Madiwala', pincode: '560068', latitude: 12.92, longitude: 77.62 }] },
  'POST /otp/send': { success: true, requestId: 'otp-r' },
  'POST /otp/verify': { verified: true },
  ...overrides,
});

describe('Register a referral partner (CA15)', () => {
  it('sends language, WhatsApp, area, pincode and how they heard, then opens the partner’s steps', async () => {
    const user = userEvent.setup();
    const api = mockApi(routes({ 'POST /referrals': { id: 'ref-1', code: 'RF-00043', registrationLinkSent: true } }));
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.referral.staff-ca', JSON.stringify(form));
    renderScreen(<RegisterReferral />, { portal: 'call-agent', path: '/call-agent/register/referral' });
    await user.click(await screen.findByRole('button', { name: 'Send OTP' }));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.paste('123456');
    await screen.findByText('✓ Verified');
    await user.click(screen.getByRole('button', { name: 'Save and create Partner ID' }));
    await waitFor(() => expect(api.calls('POST /referrals')).toHaveLength(1));
    expect(api.calls('POST /referrals')[0].body).toEqual({
      name: 'Raju Kumar', phone: '9945670011', otpRequestId: 'otp-r', type: 'individual', whatsappPhone: '9945670011', language: 'kn',
      individualRole: 'shop_owner', locality: 'Madiwala', pincode: '560068', heardFrom: 'field_visit', city: 'Bengaluru',
    });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('links the public referral partner terms in the partner’s language', async () => {
    mockApi(routes());
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.referral.staff-ca', JSON.stringify(form));
    renderScreen(<RegisterReferral />, { portal: 'call-agent', path: '/call-agent/register/referral' });
    const link = await screen.findByRole('link', { name: 'Open the full referral partner terms' });
    expect(link.getAttribute('href')).toMatch(/\/p\/referral-terms\?lang=kn$/);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('a business partner links a registered business or gives its name and type', () => {
    expect(referralBody({ ...form, type: 'business', business: { id: 'b1' } as never }, 'otp')).toMatchObject({ type: 'business', businessId: 'b1' });
    expect(referralBody({ ...form, type: 'business', partnerBusinessName: 'Ganesh Stores', partnerBusinessType: 'retail_shop' }, 'otp')).toMatchObject({
      partnerBusinessName: 'Ganesh Stores',
      partnerBusinessType: 'retail_shop',
    });
  });
});
