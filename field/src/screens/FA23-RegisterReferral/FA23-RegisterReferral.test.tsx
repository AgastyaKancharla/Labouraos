import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from '@/test/expo-router-mock';
import { clearAllFormDrafts } from '@/lib/formDraft';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import { legalDoc } from '@/test/redesign-fixtures';
import RegisterReferralScreen from '.';
import { referralBody, referralErrors, EMPTY_REFERRAL } from './payload';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

beforeEach(() => {
  jest.clearAllMocks();
  clearAllFormDrafts();
});

const options = { city: 'Bengaluru', areas: [{ name: 'JP Nagar', pincode: '560078', latitude: 12.9, longitude: 77.58 }] };

describe('FA23 Register a referral partner', () => {
  it('checks his mobile by OTP (purpose referral), reads the terms “In short”, saves him and opens his steps', async () => {
    const { route, calls } = routeTable({
      '/screens/call-registration/options': options,
      '/legal/documents/referral_terms': (_: RequestInit, url: string) => ({ status: 200, body: legalDoc('referral_terms', new URL(url).searchParams.get('lang') ?? 'en') }),
      'POST /otp/send': { requestId: 'otp-r1', resendAvailableAt: new Date(Date.now() + 30000).toISOString() },
      'POST /otp/verify': { verified: true },
      'POST /referrals': { id: 'rf-uuid', code: 'RF-00019', name: 'Manju', registrationLinkSent: true },
    });
    await renderWithApp(<RegisterReferralScreen />, { signedInAs: kiran, route });
    expect(screen.getByTestId('fa23-save')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('fa23-name'), 'Manju');
    await fireEvent.changeText(screen.getByTestId('fa23-mobile'), '9900011223');
    await fireEvent.press(screen.getByTestId('fa23-send'));
    await waitFor(() => screen.getByTestId('fa23-code'));
    expect(calls).toContainEqual({ method: 'POST', path: '/otp/send', body: { phone: '9900011223', purpose: 'referral' } });
    await fireEvent.changeText(screen.getByTestId('fa23-code'), '123456');
    await fireEvent.press(screen.getByTestId('fa23-verify'));
    await waitFor(() => expect(screen.getByTestId('fa23-save')).not.toBeDisabled());
    expect(screen.queryByTestId('fa23-language')).toBeNull(); // English only (rev 193)
    await fireEvent.press(screen.getByTestId('fa23-role'));
    await fireEvent.press(screen.getByTestId('fa23-role-option-auto_driver'));
    await fireEvent.press(screen.getByTestId('fa23-area'));
    await waitFor(() => screen.getByTestId('fa23-area-option-JP Nagar'));
    await fireEvent.press(screen.getByTestId('fa23-area-option-JP Nagar'));
    await waitFor(() => expect(screen.getByTestId('fa23-script')).toHaveTextContent(/v1.1/));
    await fireEvent.press(screen.getByTestId('fa23-save'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/job-seekers/referral-partner/rf-uuid?new=1'));
    expect(calls.find((c) => c.path === '/referrals')?.body).toEqual({
      name: 'Manju', phone: '9900011223', otpRequestId: 'otp-r1', type: 'individual', whatsappPhone: '9900011223',
      individualRole: 'auto_driver', locality: 'JP Nagar', pincode: '560078', heardFrom: 'field_visit', city: 'Bengaluru',
    });
  });

  it('a business partner needs its name and type; every field the office form asks is required', () => {
    const base = { ...EMPTY_REFERRAL, name: 'A', mobile: '9900011223', requestId: 'r', verifiedAt: 'x', area: 'JP Nagar', pincode: '560078' };
    expect(referralErrors({ ...base, type: 'business' })).toEqual(['business']);
    expect(referralBody({ ...base, type: 'business', partnerBusinessName: 'Ravi Stores', partnerBusinessType: 'retail_shop' })).toMatchObject({ type: 'business', partnerBusinessName: 'Ravi Stores', partnerBusinessType: 'retail_shop' });
    expect(referralErrors({ ...base, type: 'individual' })).toEqual(['individualRole']);
  });
});
