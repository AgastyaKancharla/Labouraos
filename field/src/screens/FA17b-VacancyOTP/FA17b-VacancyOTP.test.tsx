import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { kiran, renderWithApp } from '@/test/render';
import { business, routeTable } from '@/test/selling-fixtures';
import VacancyOtpScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

describe('FA17b Owner confirms the vacancy', () => {
  it('uses the code already sent on save; the owner reads it out; or a link is sent for later', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'vac-2', otp: 'otp-3', last4: '3310' });
    let confirmed = false;
    const { route, calls } = routeTable({
      '/vacancies/vac-2': () => ({ status: 200, body: { id: 'vac-2', code: 'VC-0002', businessId: 'biz-1', status: confirmed ? 'open' : 'awaiting_confirmation', confirmedAt: confirmed ? '2026-11-11T07:10:00Z' : null, confirmedByName: confirmed ? 'Shankar' : null } }),
      '/screens/field-selling/businesses/biz-1': business,
      'POST /vacancies/vac-2/confirm': () => {
        confirmed = true;
        return { status: 201, body: {} };
      },
      'POST /vacancies/vac-2/confirmation-link': { expiresAt: '', sentToLast4: '3310' },
    });
    await renderWithApp(<VacancyOtpScreen />, { signedInAs: kiran, route });
    await waitFor(() => screen.getByTestId('vacancy-otp-sent'));
    expect(screen.getByText(/We sent an OTP to Shankar \(owner, \*\*\*\*\*\*3310\)/)).toBeTruthy();
    expect(screen.getByTestId('show-matches')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('send-link'));
    await waitFor(() => expect(screen.getByTestId('send-link')).toHaveTextContent('Link sent to ******3310'));
    await fireEvent.changeText(screen.getByTestId('vacancy-otp-code'), '714026');
    await waitFor(() => screen.getByTestId('vacancy-confirmed'));
    expect(calls).toContainEqual({ method: 'POST', path: '/vacancies/vac-2/confirm', body: { otpRequestId: 'otp-3', code: '714026', method: 'code_on_visit' } });
    expect(screen.getByTestId('show-matches')).not.toBeDisabled();
  });
});
