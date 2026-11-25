import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, searchParams } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable } from '@/test/selling-fixtures';
import ReferralSavedScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA23b Referral partner saved', () => {
  it('shows the RF- ID and his steps on his own phone, with Resend link', async () => {
    searchParams.current = { id: 'rf-1', new: '1' };
    const { route, calls } = routeTable({
      '/referrals/rf-1': { id: 'rf-1', code: 'RF-00019', name: 'Manju', language: 'en' },
      '/referrals/rf-1/registration-status': {
        currentStep: 'selfie',
        steps: { terms: { state: 'done', time: '2026-11-16T05:10:00Z' }, selfie: { state: 'not_started' }, id: { state: 'not_started' }, upi: { state: 'not_started' } },
      },
      'POST /referrals/rf-1/terms-links': { success: true },
    });
    await renderWithApp(<ReferralSavedScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('fa23b-saved'));
    expect(screen.getByTestId('fa23b-saved')).toHaveTextContent(/Saved · RF-00019/);
    await waitFor(() => expect(screen.getByTestId('fa23b-terms')).toHaveTextContent(/Terms and consent.*Done 10:40 AM/));
    expect(screen.getByTestId('fa23b-selfie')).toHaveTextContent(/Selfie.*Not yet/);
    // Rev 211: "Send on WhatsApp" (SMS as backup) or the small "Send by SMS".
    await fireEvent.press(screen.getByTestId('fa23b-resend-whatsapp'));
    await waitFor(() => expect(screen.getByTestId('fa23b-resend')).toHaveTextContent(/Link sent again/));
    expect(calls).toContainEqual({ method: 'POST', path: '/referrals/rf-1/terms-links', body: { channel: 'whatsapp' } });
    await fireEvent.press(screen.getByTestId('fa23b-done'));
    expect(router.dismissTo).toHaveBeenCalledWith('/job-seekers');
  });
});
