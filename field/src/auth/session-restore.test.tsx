import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { createApiClient } from '@/api/client';
import { createMemoryStore, type KeyValueStore } from '@/lib/storage';
import { fakeFetch, fakeToken, kiran, type FetchRoute } from '@/test/render';
import { AuthProvider, useAuth } from './AuthProvider';
import { DEVICE_ID_KEY } from './device';
import { SESSION_STORAGE_KEY, SessionStore, type Session } from './session';

/**
 * Guide decision: closing Laboura Field does not log the agent out. The
 * 15-minute token may have run out while the app was closed; on open the app
 * restores the session with its refresh token, and the server still ends it
 * after 1 hour idle or 2 hours in total.
 */
function Probe() {
  const { status, signOutReason, session } = useAuth();
  return (
    <Text testID="auth">
      {status}|{signOutReason ?? '-'}|{session?.token ?? '-'}
    </Text>
  );
}

const T0 = Date.now();

async function seed(storage: KeyValueStore, overrides: Partial<Session> = {}) {
  const saved: Session = {
    token: fakeToken(T0 - 5 * 60_000), // ran out while the app was closed
    sessionId: 'sess-1',
    staff: kiran,
    tokenExpiresAt: T0 - 5 * 60_000,
    loginAt: T0 - 40 * 60_000,
    lastActivityAt: T0 - 20 * 60_000,
    refreshToken: 'refresh-1',
    ...overrides,
  };
  await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(saved));
  await storage.setItem(DEVICE_ID_KEY, 'phone-1');
}

async function open(route: FetchRoute, overrides: Partial<Session> = {}) {
  const storage = createMemoryStore();
  await seed(storage, overrides);
  const store = new SessionStore(storage);
  const fetchImpl = fakeFetch(route);
  const api = createApiClient({
    baseUrl: 'https://api.test',
    getToken: () => store.token(),
    onUnauthorized: () => void store.clear('unauthorized'),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  await render(
    <AuthProvider api={api} store={store} storage={storage}>
      <Probe />
    </AuthProvider>,
  );
  return { fetchImpl, store, storage };
}

describe('Laboura Field: reopening the app restores the session', () => {
  it('inside the limits: refreshes silently with the refresh token and stays signed in', async () => {
    const fresh = fakeToken(T0 + 15 * 60_000);
    const { fetchImpl, store, storage } = await open((url) =>
      url.endsWith('/auth/field/refresh') ? { status: 200, body: { accessToken: fresh, refreshToken: 'refresh-2', sessionId: 'sess-1' } } : undefined,
    );
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent(`signedIn|-|${fresh}`));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/auth/field/refresh');
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: 'sess-1', refreshToken: 'refresh-1', deviceId: 'phone-1' });
    // No bearer token: the old one ran out.
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    // The next refresh token replaces the used one, on the phone too.
    expect(store.get()?.refreshToken).toBe('refresh-2');
    expect(JSON.parse((await storage.getItem(SESSION_STORAGE_KEY))!).refreshToken).toBe('refresh-2');
    // The login time does not move: the 2-hour limit counts from login.
    expect(store.get()?.loginAt).toBe(T0 - 40 * 60_000);
  });

  it('after 1 hour idle the server refuses: signed out with the idle reason', async () => {
    await open(() => ({ status: 401, body: { statusCode: 401, message: 'Session ended after being idle', details: { reason: 'idle' } } }));
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('signedOut|idle|-'));
  });

  it('after 2 hours in total the server refuses: signed out with the 2-hour reason', async () => {
    await open(() => ({
      status: 401,
      body: { statusCode: 401, message: 'Session has reached its maximum length', details: { reason: 'max_length' } },
    }));
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('signedOut|max_length|-'));
  });

  it('a limit the phone can already see (2 hours since login) ends it without asking the server', async () => {
    const { fetchImpl } = await open(() => undefined, { loginAt: T0 - 2 * 60 * 60_000 - 60_000 });
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('signedOut|max_length|-'));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('no signal on open: keeps the session and tries again later', async () => {
    const { store } = await open(() => {
      throw new TypeError('Network request failed');
    });
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent(/^signedIn\|-\|ey/));
    expect(store.get()?.refreshToken).toBe('refresh-1');
  });

  it('a saved session without a refresh token still ends when its token has run out', async () => {
    const { fetchImpl } = await open(() => undefined, { refreshToken: null });
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('signedOut|expired|-'));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
