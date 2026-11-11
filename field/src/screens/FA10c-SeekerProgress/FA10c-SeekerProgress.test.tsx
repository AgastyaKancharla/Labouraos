import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { routeTable, seekerStatus as status } from '@/test/selling-fixtures';
import SeekerProgress from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA10c Following the registration', () => {
  it('stuck at payment: resend continues from Payment, or a payment-only link goes to another number', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'js-uuid' });
    const { route, calls } = routeTable({
      '/screens/call-registration/job-seekers/js-uuid': status({
        stage: 'in_progress', nextStep: 'payment', registrationLinkExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        steps: { phone: { state: 'done' }, consent: { state: 'done' }, selfie: { state: 'done' }, idCheck: { state: 'done' }, payment: { state: 'stuck', reason: 'UPI failed twice' } },
        consent: { requiredGiven: 5, requiredTotal: 5, promotions: false },
      }),
      'POST /job-seekers/js-uuid/payment-only-link': { expiresAt: '' },
    });
    await renderWithApp(<SeekerProgress />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('seeker-banner'));
    expect(screen.getByTestId('seeker-banner')).toHaveTextContent('✓ Link sent · valid 48 hours');
    expect(screen.getByTestId('step-payment')).toHaveTextContent(/Stuck: UPI failed twice/);
    expect(screen.getByTestId('step-consent')).toHaveTextContent(/All 5 of 5 required given · offers and news: No/);
    expect(screen.getByTestId('send-link')).toHaveTextContent('Resend link — continues from Payment');
    await fireEvent.press(screen.getByTestId('other-payer'));
    await fireEvent.changeText(screen.getByTestId('payer-mobile'), '9900011122');
    await fireEvent.press(screen.getByTestId('send-payment-link'));
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: '/job-seekers/js-uuid/payment-only-link', body: { phone: '9900011122' } }));
  });
});
