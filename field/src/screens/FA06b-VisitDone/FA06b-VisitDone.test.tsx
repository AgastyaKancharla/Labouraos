import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import VisitDoneScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const base = {
  id: 'b-1', code: 'BZ-00310', name: 'Annapoorna Mess', businessType: null, locality: null, latitude: null, longitude: null, verificationStatus: 'pending_tl_check',
  documentsStatus: null, paused: false, inPersonOnboardedAt: '2026-11-09T06:18:00Z', canShowCandidates: true, isMine: true,
  agreement: { signedAt: '2026-11-09T06:18:00Z', signedName: 'Shankar Rao' }, contact: null, branches: [],
  vacancies: [{ id: 'v1', code: 'VC-1', trade: 'Cook', headcount: 2, status: 'draft', salaryMinPaise: null, salaryMaxPaise: null, salaryPeriod: null, otpConfirmed: false }],
  stats: { candidatesShown: 0, interviews: 0, placements: 0, inGuarantee: 0 }, visits: [],
};

describe('FA06b Visit complete', () => {
  it('signed in person: candidates can be shown now; the Team Lead reviews later today', async () => {
    searchParams.current = { businessId: 'b-1', visitId: 'v-1' };
    await renderWithApp(<VisitDoneScreen />, { signedInAs: kiran, route: (url) => (url.endsWith('/field-work/businesses/b-1') ? { status: 200, body: base } : undefined) });
    await waitFor(() => screen.getByTestId('fa06b-banner'));
    expect(screen.getByTestId('fa06b-banner')).toHaveTextContent(/agreement signed by Shankar Rao/);
    expect(screen.getByTestId('fa06b-agreement')).toHaveTextContent(/Signed 11:48 AM/);
    expect(screen.getByText('Cook × 2')).toBeTruthy();
    expect(screen.getByText('Later today')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fa06b-show'));
    expect(router.push).toHaveBeenCalledWith('/job-seekers/b-1');
    await fireEvent.press(screen.getByTestId('fa06b-outcome'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/visit/outcome', params: { id: 'v-1' } });
  });

  it('not signed yet: candidates stay hidden', async () => {
    searchParams.current = { businessId: 'b-1' };
    await renderWithApp(<VisitDoneScreen />, {
      signedInAs: kiran,
      route: (url) => (url.endsWith('/field-work/businesses/b-1') ? { status: 200, body: { ...base, agreement: null, canShowCandidates: false, verificationStatus: 'lead', inPersonOnboardedAt: null } } : undefined),
    });
    await waitFor(() => screen.getByTestId('fa06b-banner'));
    expect(screen.getByTestId('fa06b-banner')).toHaveTextContent(/waiting for the agreement/);
    expect(screen.getByTestId('fa06b-show').props.accessibilityState.disabled).toBe(true);
  });
});
