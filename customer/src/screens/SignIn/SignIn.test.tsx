import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { router } from 'expo-router';
import Start from '../../../app/index';
import { account, jsProfile } from '@/test/fixtures';
import { fakeApi, renderWithApp } from '@/test/render';
import SignInPhone from '../SignInPhone';
import VerifyPhone from '../VerifyPhone';
import SignIn from './index';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const otpSent = async () => ({ requestId: 'req-1', resendAvailableAt: new Date(Date.now() + 30_000).toISOString(), resendsLeft: 3 });

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
});

describe('Sign in', () => {
  it('offers Google and mobile number (Apple only on iPhone when available)', async () => {
    await renderWithApp(<SignIn />);
    expect(screen.getByTestId('sign-in-google')).toHaveTextContent('Continue with Google');
    expect(screen.getByTestId('sign-in-mobile')).toHaveTextContent('Continue with mobile number');
    expect(screen.queryByTestId('sign-in-apple')).toBeNull();
    await fireEvent.press(screen.getByTestId('sign-in-mobile'));
    expect(router.push).toHaveBeenCalledWith('/sign-in-phone');
  });

  it('Google: sends only the ID token to the server, then goes to the start (which asks for the phone)', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
    const api = fakeApi({ signInWithGoogle: async () => ({ accessToken: 'tok', account: account({ phoneVerified: false, signInMethods: ['google'] }) }) });
    await renderWithApp(<SignIn />, { api });
    await fireEvent.press(screen.getByTestId('sign-in-google'));
    await waitFor(() => expect(api.signInWithGoogle).toHaveBeenCalledWith('google-id-token'));
    expect(GoogleSignin.configure).toHaveBeenCalledWith(expect.objectContaining({ webClientId: 'web-client.apps.googleusercontent.com' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('hides Google when the server has it switched off (GET /config)', async () => {
    const api = fakeApi({ config: async () => ({ googleSignIn: false, googleWebClientId: null, googleIosClientId: null, appleSignIn: false, otpTestMode: false }) });
    await renderWithApp(<SignIn />, { api });
    await waitFor(() => expect(screen.queryByTestId('sign-in-google')).toBeNull());
    expect(screen.getByTestId('sign-in-mobile')).toBeTruthy();
  });

  it('uses the Google client id from the server when the build has none', async () => {
    const api = fakeApi({
      config: async () => ({ googleSignIn: true, googleWebClientId: 'from-server.apps.googleusercontent.com', googleIosClientId: null, appleSignIn: false, otpTestMode: false }),
      signInWithGoogle: async () => ({ accessToken: 'tok', account: account({ phoneVerified: false }) }),
    });
    await renderWithApp(<SignIn />, { api });
    await waitFor(() => expect(api.config).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    await fireEvent.press(screen.getByTestId('sign-in-google'));
    await waitFor(() => expect(api.signInWithGoogle).toHaveBeenCalledWith('google-id-token'));
  });

  it('Google not set up in this build: says so and points to the mobile number', async () => {
    await renderWithApp(<SignIn />);
    await fireEvent.press(screen.getByTestId('sign-in-google'));
    expect(await screen.findByTestId('sign-in-error')).toHaveTextContent(/not set up in this test app/);
  });

  it('Google cancelled: no error, nothing sent', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client';
    (GoogleSignin.signIn as jest.Mock).mockResolvedValueOnce({ type: 'cancelled', data: null });
    const api = fakeApi();
    await renderWithApp(<SignIn />, { api });
    await fireEvent.press(screen.getByTestId('sign-in-google'));
    await waitFor(() => expect(GoogleSignin.signIn).toHaveBeenCalled());
    expect(screen.queryByTestId('sign-in-error')).toBeNull();
    expect(api.signInWithGoogle).not.toHaveBeenCalled();
  });
});

describe('Mobile number + OTP sign-in', () => {
  it('refuses a number that is not 10 digits starting 6–9', async () => {
    const api = fakeApi();
    await renderWithApp(<SignInPhone />, { api });
    await fireEvent.changeText(screen.getByTestId('phone-otp-mobile'), '12345');
    await fireEvent.press(screen.getByTestId('phone-otp-send'));
    expect(screen.getByTestId('phone-otp-error')).toHaveTextContent('Enter a 10-digit mobile number.');
    expect(api.sendSignInOtp).not.toHaveBeenCalled();
  });

  it('sends the OTP, locks resend for 30 seconds, verifies with the contact tick and starts the session', async () => {
    const api = fakeApi({
      sendSignInOtp: otpSent,
      verifySignInOtp: async () => ({ accessToken: 'tok', account: account() }),
    });
    const { store } = await renderWithApp(<SignInPhone />, { api });
    await fireEvent.changeText(screen.getByTestId('phone-otp-mobile'), '9876543210');
    await fireEvent.press(screen.getByTestId('phone-otp-consent'));
    await fireEvent.press(screen.getByTestId('phone-otp-send'));
    expect(api.sendSignInOtp).toHaveBeenCalledWith('9876543210', undefined);
    expect(await screen.findByText('Code sent to the number ending 3210.')).toBeTruthy();
    expect(screen.getByTestId('phone-otp-resend')).toHaveTextContent(/Resend in 0:[0-3]\d/);
    expect(screen.getByTestId('phone-otp-resend')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('phone-otp-code'), '123456');
    await waitFor(() => expect(api.verifySignInOtp).toHaveBeenCalledWith({ phone: '9876543210', requestId: 'req-1', code: '123456', contactConsent: true }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(store.token()).toBe('tok');
  });

  it('a wrong code: the app own words from the contract code, with tries left; stays on the screen', async () => {
    const { ApiError } = require('@/api/errors');
    const api = fakeApi({
      sendSignInOtp: otpSent,
      verifySignInOtp: async () => {
        throw new ApiError({ status: 400, messages: ['Wrong OTP'], body: { statusCode: 400, code: 'OTP_INVALID', message: 'Wrong OTP', attemptsLeft: 2 } });
      },
    });
    await renderWithApp(<SignInPhone />, { api });
    await fireEvent.changeText(screen.getByTestId('phone-otp-mobile'), '9876543210');
    await fireEvent.press(screen.getByTestId('phone-otp-send'));
    await fireEvent.changeText(await screen.findByTestId('phone-otp-code'), '000000');
    expect(await screen.findByTestId('phone-otp-error')).toHaveTextContent('That code is not right. 2 tries left.');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('allows at most 3 resends', async () => {
    const api = fakeApi({ sendSignInOtp: async () => ({ requestId: 'r', resendAvailableAt: new Date(Date.now() - 1000).toISOString(), resendsLeft: 3 }) });
    await renderWithApp(<SignInPhone />, { api });
    await fireEvent.changeText(screen.getByTestId('phone-otp-mobile'), '9876543210');
    await fireEvent.press(screen.getByTestId('phone-otp-send'));
    for (let i = 0; i < 3; i += 1) {
      await fireEvent.press(await screen.findByTestId('phone-otp-resend'));
      await waitFor(() => expect(api.sendSignInOtp).toHaveBeenCalledTimes(i + 2));
    }
    expect(api.sendSignInOtp).toHaveBeenLastCalledWith('9876543210', 'r'); // a resend names the request it repeats
    expect(await screen.findByTestId('phone-otp-no-resends')).toBeTruthy();
    expect(screen.queryByTestId('phone-otp-resend')).toBeNull();
  });
});

describe('After Google: the mobile number comes before any profile', () => {
  it('when the number belonged to an earlier mobile account, the new tokens from the server replace ours', async () => {
    const api = fakeApi({
      sendPhoneOtp: otpSent,
      verifyPhoneOtp: async () => ({ account: account({ profiles: [jsProfile] }), linkedExisting: [], session: { accessToken: 'joined-token', refreshToken: 'joined-refresh' } }),
    });
    const { store } = await renderWithApp(<VerifyPhone />, { api, account: account({ phoneVerified: false, signInMethods: ['google'] }) });
    await fireEvent.changeText(await screen.findByTestId('verify-otp-mobile'), '9123456780');
    await fireEvent.press(screen.getByTestId('verify-otp-send'));
    await fireEvent.changeText(await screen.findByTestId('verify-otp-code'), '123456');
    await screen.findByTestId('verify-phone-done');
    expect(store.token()).toBe('joined-token');
    expect(store.session()?.refreshToken).toBe('joined-refresh');
  });

  it('the start screen sends an account without a verified phone to "Your mobile number"', async () => {
    await renderWithApp(<Start />, { account: account({ phoneVerified: false, phoneLast4: null, signInMethods: ['google'] }) });
    expect(await screen.findByTestId('redirect')).toHaveTextContent('/verify-phone');
  });

  it('a verified account with no profile goes to the role picker; with a profile, Home', async () => {
    const first = await renderWithApp(<Start />, { account: account() });
    expect(await screen.findByTestId('redirect')).toHaveTextContent('/role');
    first.unmount();
    await renderWithApp(<Start />, { account: account({ profiles: [jsProfile] }) });
    expect(await screen.findByTestId('redirect')).toHaveTextContent('/home');
  });

  it('a signed-out person starts at the language screen', async () => {
    await renderWithApp(<Start />);
    expect(await screen.findByTestId('redirect')).toHaveTextContent('/welcome');
  });

  it('verifies the number and says when it found an agent-made registration', async () => {
    const verified = account({ profiles: [jsProfile], signInMethods: ['google', 'phone'] });
    const api = fakeApi({
      sendPhoneOtp: otpSent,
      verifyPhoneOtp: async () => ({ account: verified, linkedExisting: [{ kind: 'job_seeker', code: 'JS-1234' }] }),
    });
    await renderWithApp(<VerifyPhone />, { api, account: account({ name: 'Asha K', phoneVerified: false, signInMethods: ['google'] }) });
    expect(await screen.findByText('Hello Asha')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('verify-otp-mobile'), '9123456780');
    await fireEvent.press(screen.getByTestId('verify-otp-send'));
    expect(api.sendPhoneOtp).toHaveBeenCalledWith({ phone: '9123456780', contactConsent: false, resendOf: undefined });
    await fireEvent.changeText(await screen.findByTestId('verify-otp-code'), '123456');
    expect(await screen.findByTestId('verify-phone-found-JS-1234')).toHaveTextContent(/We found your registration JS-1234/);
    await fireEvent.press(screen.getByTestId('verify-phone-continue'));
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});
