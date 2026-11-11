import { screen, waitFor } from '@testing-library/react-native';
import { searchParams } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import BusinessScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const business = {
  id: 'b-3', code: 'BZ-00291', name: 'Green Leaf Café', businessType: 'restaurant_hotel', locality: 'Koramangala 5th Block', latitude: 12.93, longitude: 77.62,
  verificationStatus: 'verified', documentsStatus: 'documented', paused: false, inPersonOnboardedAt: null, canShowCandidates: true, isMine: true,
  agreement: { signedAt: '2026-11-02T05:00:00Z', signedName: 'Ganesh' },
  contact: { name: 'Ganesh', role: 'owner', phone: '******3310' },
  branches: [{ id: 'br-1', name: 'HSR', locality: 'HSR Layout', contactPersonName: 'Ravi', contactPersonRole: 'manager' }],
  vacancies: [
    { id: 'vc-1', code: 'VC-1', trade: 'Waiter', headcount: 2, status: 'open', salaryMinPaise: 1400000, salaryMaxPaise: 1600000, salaryPeriod: 'monthly', otpConfirmed: true },
    { id: 'vc-2', code: 'VC-2', trade: 'Cook', headcount: 1, status: 'awaiting_confirmation', salaryMinPaise: 2000000, salaryMaxPaise: 2400000, salaryPeriod: 'monthly', otpConfirmed: false },
  ],
  stats: { candidatesShown: 9, interviews: 4, placements: 2, inGuarantee: 1 },
  visits: [{ id: 'x-1', at: '2026-11-02T05:00:00Z', durationSeconds: 480, purpose: 'shop_visit', hasBoardPhoto: true, hasSelfie: false, outcome: 'interested_later', staffName: 'Kiran Kumar', mine: true }],
};

describe('FA08 Business page', () => {
  it('shows status, masked contact and branches, vacancies with OTP status, results and the visit history', async () => {
    searchParams.current = { id: 'b-3' };
    await renderWithApp(<BusinessScreen />, { signedInAs: kiran, route: (url) => (url.endsWith('/field-work/businesses/b-3') ? { status: 200, body: business } : undefined) });
    await waitFor(() => screen.getByTestId('fa08-contact'));
    expect(screen.getByText(/Restaurant \/ hotel · Koramangala 5th Block · BZ-00291 · your account/)).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByTestId('fa08-contact')).toHaveTextContent(/Ganesh · Owner.*\*{6}3310/);
    expect(screen.getByText(/Waiter × 2/)).toBeTruthy();
    expect(screen.getByText(/₹14–16k · OTP confirmed/)).toBeTruthy();
    expect(screen.getAllByText('Waiting for OTP').length).toBeGreaterThan(0);
    expect(screen.getByText(/2 · 1 in guarantee/)).toBeTruthy();
    expect(screen.getByTestId('fa08-visits')).toHaveTextContent(/Mon 2 Nov · 8 min · 📷.*Come back/);
  });

  it('another agent’s business: no contact details', async () => {
    searchParams.current = { id: 'b-3' };
    await renderWithApp(<BusinessScreen />, {
      signedInAs: kiran,
      route: (url) => (url.endsWith('/field-work/businesses/b-3') ? { status: 200, body: { ...business, isMine: false, contact: null, branches: [] } } : undefined),
    });
    await waitFor(() => screen.getByTestId('fa08-not-yours'));
    expect(screen.getByTestId('fa08-call').props.accessibilityState.disabled).toBe(true);
  });
});
