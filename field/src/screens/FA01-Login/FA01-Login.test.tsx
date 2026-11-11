import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import LoginCodeScreen from '../FA02-LoginCode';
import { fakeToken, kiran, renderWithApp, type FetchRoute } from '@/test/render';
import LoginScreen from '.';

jest.mock('expo-router', () => require('@/test/expo-router-mock'));

const awaiting = { status: 'awaiting_code', loginRequestId: 'lr-1', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };

function body(init: RequestInit) {
  return JSON.parse(String(init.body)) as Record<string, string>;
}

beforeEach(() => jest.clearAllMocks());

describe('FA01 field agent sign in', () => {
  it('asks for both fields before calling the server', async () => {
    const { fetchImpl } = await renderWithApp(<LoginScreen />);
    await fireEvent.press(screen.getByTestId('sign-in'));
    expect(screen.getByTestId('login-error')).toHaveTextContent('Enter your staff code and password.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends staff code, password and this phone\'s id, then goes to the code screen', async () => {
    const { fetchImpl } = await renderWithApp(<LoginScreen />, {
      route: (url) => (url.endsWith('/auth/login') ? { status: 200, body: awaiting } : undefined),
    });
    await fireEvent.changeText(screen.getByTestId('staff-code'), ' FA-00017 ');
    await fireEvent.changeText(screen.getByTestId('password'), 'secret-pass');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/login-code'));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/auth/login');
    expect(body(init)).toMatchObject({ staffCode: 'FA-00017', password: 'secret-pass' });
    expect(body(init).deviceId).toMatch(/^uuid-/);
  });

  it('explains a phone waiting for Team Lead approval, with the phone\'s short id', async () => {
    await renderWithApp(<LoginScreen />, {
      route: () => ({ status: 401, body: { message: 'This device is waiting for approval by your Team Lead' } }),
    });
    await fireEvent.changeText(screen.getByTestId('staff-code'), 'FA-00017');
    await fireEvent.changeText(screen.getByTestId('password'), 'x');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => expect(screen.getByTestId('login-error')).toHaveTextContent(/waiting for your Team Lead to approve it.*phone UUID\d{1,4}\b/i));
  });

  it('shows wrong password and locked messages in the chosen language', async () => {
    await renderWithApp(<LoginScreen />, {
      language: 'kn',
      route: () => ({ status: 401, body: { message: 'Invalid staff code or password' } }),
    });
    await fireEvent.changeText(screen.getByTestId('staff-code'), 'FA-00017');
    await fireEvent.changeText(screen.getByTestId('password'), 'x');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => expect(screen.getByTestId('login-error')).toHaveTextContent('ಸ್ಟಾಫ್ ಕೋಡ್ ಅಥವಾ ಪಾಸ್‌ವರ್ಡ್ ತಪ್ಪಾಗಿದೆ.'));
  });

  it('asks a management account for its authenticator code and signs straight in', async () => {
    const { fetchImpl, store } = await renderWithApp(<LoginScreen />, {
      route: (_url, init) =>
        body(init).totpCode
          ? { status: 200, body: { accessToken: fakeToken(), sessionId: 's', staff: { id: 'ceo-1', code: 'CEO-1', name: 'Sanket', role: 'ceo', email: null } } }
          : { status: 401, body: { message: 'TOTP 2FA code is required' } },
    });
    await fireEvent.changeText(screen.getByTestId('staff-code'), 'CEO-1');
    await fireEvent.changeText(screen.getByTestId('password'), 'x');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => screen.getByTestId('totp-code'));
    await fireEvent.changeText(screen.getByTestId('totp-code'), '123456');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(body((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1]).totpCode).toBe('123456');
    expect(store.get()?.staff.role).toBe('ceo');
  });
});

describe('FA02 login code', () => {
  async function toCodeScreen(route: FetchRoute) {
    const utils = await renderWithApp(
      <>
        <LoginScreen />
        <LoginCodeScreen />
      </>,
      { route },
    );
    await fireEvent.changeText(screen.getByTestId('staff-code'), 'FA-00017');
    await fireEvent.changeText(screen.getByTestId('password'), 'x');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => screen.getByTestId('login-code'));
    return utils;
  }

  it('sends to sign in when no login is waiting', async () => {
    await renderWithApp(<LoginCodeScreen />);
    expect(screen.getByTestId('redirect')).toHaveTextContent('/login');
  });

  it('signs in with the code read out by the Team Lead and keeps the session on the phone', async () => {
    const { store, fetchImpl } = await toCodeScreen((url) => {
      if (url.endsWith('/auth/login')) return { status: 200, body: awaiting };
      if (url.endsWith('/auth/login/verify-code')) {
        return { status: 200, body: { accessToken: fakeToken(), sessionId: 'sess-9', staff: { ...kiran, email: null } } };
      }
      return undefined;
    });
    await fireEvent.changeText(screen.getByTestId('login-code'), '720453');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    const init = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(body(init)).toEqual({ loginRequestId: 'lr-1', code: '720453' });
    expect(store.get()).toMatchObject({ sessionId: 'sess-9', staff: { code: 'FA-00017' } });
  });

  it('says when the code is wrong and clears it', async () => {
    await toCodeScreen((url) =>
      url.endsWith('/auth/login') ? { status: 200, body: awaiting } : { status: 401, body: { message: 'Login code is not valid' } },
    );
    await fireEvent.changeText(screen.getByTestId('login-code'), '111111');
    await waitFor(() => expect(screen.getByTestId('code-error')).toHaveTextContent(/not right/));
  });

  it('offers to start again once the 5 minutes are up', async () => {
    await toCodeScreen((url) =>
      url.endsWith('/auth/login')
        ? { status: 200, body: { ...awaiting, expiresAt: new Date(Date.now() - 1000).toISOString() } }
        : undefined,
    );
    await waitFor(() => screen.getByTestId('code-expired'));
    await fireEvent.press(screen.getByTestId('start-again'));
    expect(router.replace).toHaveBeenCalledWith('/login');
  });
});
