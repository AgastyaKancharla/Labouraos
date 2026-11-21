import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderScreen, signInAs } from '../../../test/utils';
import RegisterReferral from './index';
import { EMPTY_REFERRAL, placeFromBusiness, referralBody, type ReferralForm } from './payload';

const form: ReferralForm = {
  ...EMPTY_REFERRAL,
  name: 'Raju Kumar',
  mobile: '9945670011',
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
  it('sends WhatsApp, area, pincode and how they heard (no message language), then opens the partner’s steps', async () => {
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
      name: 'Raju Kumar', phone: '9945670011', otpRequestId: 'otp-r', type: 'individual', whatsappPhone: '9945670011',
      individualRole: 'shop_owner', locality: 'Madiwala', pincode: '560068', heardFrom: 'field_visit', city: 'Bengaluru',
    });
    expect(await screen.findByTestId('navigated-away')).toBeInTheDocument();
  });

  it('links the public referral partner terms', async () => {
    mockApi(routes());
    signInAs('call_agent');
    sessionStorage.setItem('laboura.draft.referral.staff-ca', JSON.stringify(form));
    renderScreen(<RegisterReferral />, { portal: 'call-agent', path: '/call-agent/register/referral' });
    const link = await screen.findByRole('link', { name: 'Open the full referral partner terms' });
    expect(link.getAttribute('href')).toMatch(/\/p\/referral-terms$/);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('a business partner links a registered business or gives its name and type', () => {
    expect(referralBody({ ...form, type: 'business', business: { id: 'b1' } as never }, 'otp')).toMatchObject({ type: 'business', businessId: 'b1' });
    expect(referralBody({ ...form, type: 'business', partnerBusinessName: 'Ganesh Stores', partnerBusinessType: 'retail_shop' }, 'otp')).toMatchObject({
      partnerBusinessName: 'Ganesh Stores',
      partnerBusinessType: 'retail_shop',
    });
  });

  it('22 Nov: a partner who is a registered business takes its area, pincode and pin (fields hidden)', async () => {
    const zoom = {
      id: 'b5', code: 'BZ-00005', name: 'Zoom food court', locality: 'JP Nagar', pincode: '560078', hasPin: true,
      verificationStatus: 'verified', canShowCandidates: true, contactName: null, contactRole: null, branches: [],
    };
    const user = userEvent.setup();
    const api = mockApi(routes({ 'POST /referrals': { id: 'ref-2', code: 'RF-00044', registrationLinkSent: true } }));
    signInAs('call_agent');
    const draft: ReferralForm = { ...form, type: 'business', individualRole: '', business: zoom, place: { area: '', pincode: '', latitude: null, longitude: null } };
    sessionStorage.setItem('laboura.draft.referral.staff-ca', JSON.stringify(draft));
    renderScreen(<RegisterReferral />, { portal: 'call-agent', path: '/call-agent/register/referral' });
    expect(await screen.findByTestId('place-from-business')).toHaveTextContent('From BZ-00005: JP Nagar, 560078');
    expect(screen.getByTestId('place-from-business')).toHaveTextContent('Map pin from the business too.');
    expect(screen.queryByLabelText(/Pincode/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send OTP' }));
    await user.click(await screen.findByLabelText('Digit 1 of 6'));
    await user.paste('123456');
    await screen.findByText('✓ Verified');
    await user.click(screen.getByRole('button', { name: 'Save and create Partner ID' }));
    await waitFor(() => expect(api.calls('POST /referrals')).toHaveLength(1));
    expect(api.calls('POST /referrals')[0].body).toEqual({
      name: 'Raju Kumar', phone: '9945670011', otpRequestId: 'otp-r', type: 'business', whatsappPhone: '9945670011',
      businessId: 'b5', locality: 'JP Nagar', pincode: '560078', heardFrom: 'field_visit', city: 'Bengaluru',
    });
    // A business with no pincode on file: the fields are asked as before.
    expect(placeFromBusiness({ type: 'business', business: { ...zoom, pincode: null } })).toBeNull();
    expect(placeFromBusiness({ type: 'individual', business: zoom })).toBeNull();
  });
});
