import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import LoginScreen from '../FA01-Login';
import ForgotPasswordScreen from '../FA01c-Forgot';
import { renderWithApp } from '@/test/render';
import SetupScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const setupRequired = {
  status: 'setup_required',
  setupTicket: 'ticket-1',
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  staff: { code: 'FA-00017', name: 'Kiran R', role: 'field_agent' },
  photoRequired: false,
  authenticatorSetupRequired: false,
  authenticatorCodeRequired: false,
  passwordRules: { minLength: 8, maxBytes: 72 },
  signInAt: 'field_app',
};

function body(init: RequestInit) {
  return JSON.parse(String(init.body)) as Record<string, string>;
}

beforeEach(() => jest.clearAllMocks());

describe('FA01b set your password (first login with the temporary password)', () => {
  it('sends to sign in when no set-up is waiting', async () => {
    await renderWithApp(<SetupScreen />);
    expect(screen.getByTestId('redirect')).toHaveTextContent('/login');
  });

  it('recognises the temporary password, then sets a new password twice (not the temporary one) and goes back to sign in', async () => {
    const { fetchImpl, store } = await renderWithApp(
      <>
        <LoginScreen />
        <SetupScreen />
      </>,
      {
        route: (url) => {
          if (url.endsWith('/auth/login')) return { status: 200, body: setupRequired };
          if (url.endsWith('/auth/setup/complete')) return { status: 200, body: { success: true, code: 'FA-00017', signInAt: 'field_app' } };
          return undefined;
        },
      },
    );
    await fireEvent.changeText(screen.getByTestId('staff-code'), 'FA-00017');
    await fireEvent.changeText(screen.getByTestId('password'), 'k7m4-q2px');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/setup'));
    await waitFor(() => screen.getByTestId('setup-password'));
    // The temporary password in another form is refused before anything is sent.
    await fireEvent.changeText(screen.getByTestId('setup-password'), 'K7M4Q2PX');
    await fireEvent.changeText(screen.getByTestId('setup-confirm'), 'K7M4Q2PX');
    await fireEvent.press(screen.getByTestId('setup-finish'));
    expect(screen.getByTestId('setup-error')).toHaveTextContent(/different from the temporary password/);
    await fireEvent.changeText(screen.getByTestId('setup-password'), 'my-own-pass');
    await fireEvent.changeText(screen.getByTestId('setup-confirm'), 'my-own-pass');
    await fireEvent.press(screen.getByTestId('setup-finish'));
    await waitFor(() => expect(screen.getByTestId('setup-done')).toHaveTextContent(/Sign in with staff code FA-00017/));
    const loginInit = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/auth/setup/complete');
    expect(body(init)).toEqual({ setupTicket: 'ticket-1', deviceId: body(loginInit).deviceId, newPassword: 'my-own-pass', confirmPassword: 'my-own-pass' });
    // No session from the set-up: they sign in again with the new password.
    expect(store.get()).toBeNull();
    await fireEvent.press(screen.getByTestId('setup-sign-in'));
    expect(router.replace).toHaveBeenCalledWith('/login');
  });

  it('asks for the selfie first when no staff photo is on file, and says when the set-up has ended', async () => {
    await renderWithApp(
      <>
        <LoginScreen />
        <SetupScreen />
      </>,
      {
        route: (url) => {
          if (url.endsWith('/auth/login')) return { status: 200, body: { ...setupRequired, photoRequired: true } };
          if (url.endsWith('/auth/setup/complete')) return { status: 401, body: { message: 'This set-up has ended.' } };
          return undefined;
        },
      },
    );
    await fireEvent.changeText(screen.getByTestId('staff-code'), 'FA-00017');
    await fireEvent.changeText(screen.getByTestId('password'), 'K7M4-Q2PX');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => screen.getByTestId('setup-photo-open'));
    await fireEvent.press(screen.getByTestId('setup-photo-later'));
    await fireEvent.changeText(screen.getByTestId('setup-password'), 'my-own-pass');
    await fireEvent.changeText(screen.getByTestId('setup-confirm'), 'my-own-pass');
    await fireEvent.press(screen.getByTestId('setup-finish'));
    await waitFor(() => expect(screen.getByTestId('setup-expired')).toHaveTextContent(/Sign in again with your staff code and temporary password/));
  });
});

describe('FA01c forgot password (reset code from a senior)', () => {
  it('asks with the staff code, then sends the reset code and the new password twice from this phone', async () => {
    const answer = { status: 'requested', message: 'x', resetRequestId: 'rr-1', resetRequestProof: 'rp-1', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
    const { fetchImpl, store } = await renderWithApp(<ForgotPasswordScreen />, {
      route: (url) => {
        if (url.endsWith('/auth/password-reset/request')) return { status: 200, body: answer };
        if (url.endsWith('/auth/password-reset/complete')) return { status: 200, body: { success: true, code: 'FA-00017', signInAt: 'field_app' } };
        return undefined;
      },
    });
    await fireEvent.changeText(screen.getByTestId('reset-staff-code'), 'FA-00017');
    await fireEvent.press(screen.getByTestId('reset-ask'));
    await waitFor(() => screen.getByTestId('reset-code'));
    expect(screen.getByText('Ask your senior for the reset code')).toBeTruthy();
    const askInit = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(body(askInit)).toMatchObject({ staffCode: 'FA-00017', app: 'field' });
    await fireEvent.changeText(screen.getByTestId('reset-code'), '493017');
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'new-pass-1');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'new-pass-1');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    await waitFor(() => expect(screen.getByTestId('reset-done')).toHaveTextContent(/Sign in with staff code FA-00017/));
    const init = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(body(init)).toEqual({
      resetRequestId: 'rr-1',
      resetRequestProof: 'rp-1',
      deviceId: body(askInit).deviceId,
      code: '493017',
      newPassword: 'new-pass-1',
      confirmPassword: 'new-pass-1',
      app: 'field',
    });
    expect(store.get()).toBeNull();
  });

  it('shows the server refusal of a wrong reset code', async () => {
    const answer = { status: 'requested', message: 'x', resetRequestId: 'rr-2', resetRequestProof: 'rp-2', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
    await renderWithApp(<ForgotPasswordScreen />, {
      route: (url) =>
        url.endsWith('/auth/password-reset/request')
          ? { status: 200, body: answer }
          : { status: 401, body: { message: 'Reset code is not valid' } },
    });
    await fireEvent.changeText(screen.getByTestId('reset-staff-code'), 'FA-00017');
    await fireEvent.press(screen.getByTestId('reset-ask'));
    await waitFor(() => screen.getByTestId('reset-code'));
    await fireEvent.changeText(screen.getByTestId('reset-code'), '111111');
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'new-pass-1');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'new-pass-1');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    await waitFor(() => expect(screen.getByTestId('reset-error')).toHaveTextContent(/Reset code is not valid/));
  });
});
