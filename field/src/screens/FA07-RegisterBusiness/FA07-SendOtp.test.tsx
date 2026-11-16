import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { searchParams } from '@/test/expo-router-mock';
import { kiran, renderWithApp } from '@/test/render';
import RegisterBusinessScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

/**
 * Owner, testing 16 Nov: "Send OTP does nothing" on Register a business. The
 * number belonged to a job seeker, the API answered { alreadyRegistered,
 * type, code }, and the form showed it only at the bottom of the long page
 * (reading `existingCode`, which the API never sends). The answer is now shown
 * under the mobile field and next to the button.
 */
function routeWith(otpAnswer: unknown) {
  return (url: string) => {
    if (url.endsWith('/screens/call-registration/options')) return { status: 200, body: { city: 'Bengaluru', areas: [] } };
    if (url.endsWith('/trades')) return { status: 200, body: [] };
    if (url.endsWith('/otp/send')) return { status: 201, body: otpAnswer };
    return undefined;
  };
}

describe('FA07 Send OTP answers are shown next to the mobile field', () => {
  beforeEach(() => {
    searchParams.current = {};
  });

  it('a number that belongs to a job seeker: says so, with the code, under the field and beside the button', async () => {
    await renderWithApp(<RegisterBusinessScreen />, { signedInAs: kiran, route: routeWith({ alreadyRegistered: true, type: 'job_seeker', code: 'JS-00042' }) });
    await fireEvent.changeText(screen.getByTestId('fa07-mobile'), '9900054321');
    await fireEvent.press(screen.getByTestId('fa07-mobile-send'));
    await waitFor(() => screen.getByTestId('fa07-mobile-problem'));
    expect(screen.getByTestId('fa07-mobile-problem')).toHaveTextContent('This number is already registered as a job seeker (JS-00042).');
    // Also the field's own error line, right under the number.
    expect(screen.getAllByText('This number is already registered as a job seeker (JS-00042).').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('fa07-mobile-verify')).toBeNull();
    // Changing the number clears it.
    await fireEvent.changeText(screen.getByTestId('fa07-mobile'), '9900054322');
    expect(screen.queryByTestId('fa07-mobile-problem')).toBeNull();
  });

  it('a business or referral partner number names that kind of record; a record the agent may not see still says registered', async () => {
    await renderWithApp(<RegisterBusinessScreen />, { signedInAs: kiran, route: routeWith({ alreadyRegistered: true, type: 'referral', code: 'RF-00007' }) });
    await fireEvent.changeText(screen.getByTestId('fa07-mobile'), '9900054321');
    await fireEvent.press(screen.getByTestId('fa07-mobile-send'));
    await waitFor(() => expect(screen.getByTestId('fa07-mobile-problem')).toHaveTextContent(/already registered as a referral partner \(RF-00007\)/));
  });

  it('a hidden record (no type or code in the answer) still explains what happened', async () => {
    await renderWithApp(<RegisterBusinessScreen />, { signedInAs: kiran, route: routeWith({ alreadyRegistered: true }) });
    await fireEvent.changeText(screen.getByTestId('fa07-mobile'), '9900054321');
    await fireEvent.press(screen.getByTestId('fa07-mobile-send'));
    await waitFor(() => expect(screen.getByTestId('fa07-mobile-problem')).toHaveTextContent(/already registered in Laboura/));
  });

  it('an answer with neither requestId nor alreadyRegistered shows a clear error instead of nothing', async () => {
    await renderWithApp(<RegisterBusinessScreen />, { signedInAs: kiran, route: routeWith({ success: true }) });
    await fireEvent.changeText(screen.getByTestId('fa07-mobile'), '9900054321');
    await fireEvent.press(screen.getByTestId('fa07-mobile-send'));
    await waitFor(() => expect(screen.getByTestId('fa07-mobile-problem')).toHaveTextContent('The code was not sent: the server gave no answer. Try again.'));
    expect(screen.queryByTestId('fa07-mobile-verify')).toBeNull();
  });

  it('a wrong number is refused next to the field too', async () => {
    await renderWithApp(<RegisterBusinessScreen />, { signedInAs: kiran, route: routeWith({ requestId: 'r1' }) });
    await fireEvent.changeText(screen.getByTestId('fa07-mobile'), '12345');
    await fireEvent.press(screen.getByTestId('fa07-mobile-send'));
    await waitFor(() => expect(screen.getByTestId('fa07-mobile-problem')).toHaveTextContent('Enter 10 digits starting with 6–9.'));
  });
});
