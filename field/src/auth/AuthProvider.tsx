import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { sessionStore as defaultStore } from '@/api';
import { useApi } from '@/api/ApiProvider';
import type { ApiClient } from '@/api/client';
import { authApi, isAwaitingCode, type AwaitingCodeResponse } from '@/api/endpoints/auth';
import { secureStorage, type KeyValueStore } from '@/lib/storage';
import { getDeviceId } from './device';
import { SessionStore, type Session, type SignOutReason } from './session';

/** Refresh the 15-minute access token when less than this is left. */
export const REFRESH_WHEN_LEFT_MS = 5 * 60 * 1000;
export const CHECK_EVERY_MS = 60 * 1000;

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface PendingLogin extends AwaitingCodeResponse {
  staffCode: string;
}

export type StartLoginResult = { kind: 'awaiting_code' } | { kind: 'signed_in' };

interface AuthValue {
  status: AuthStatus;
  session: Session | null;
  /** Why the last session ended (shown on the sign-in screen). Cleared on the next login. */
  signOutReason: SignOutReason | null;
  pendingLogin: PendingLogin | null;
  deviceId: string | null;
  /** FA01: staff code + password (+ authenticator code for management accounts). */
  startLogin: (staffCode: string, password: string, totpCode?: string) => Promise<StartLoginResult>;
  /** FA02: the 6-digit code read out by the Team Lead. */
  verifyCode: (code: string) => Promise<void>;
  cancelPendingLogin: () => void;
  logout: () => Promise<void>;
  /** Call on any tap; keeps the 1-hour idle limit honest. */
  touch: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

interface Props {
  children: ReactNode;
  /** Tests inject these. */
  api?: ApiClient;
  store?: SessionStore;
  storage?: KeyValueStore;
  now?: () => number;
}

export function AuthProvider({ children, api: injectedApi, store = defaultStore, storage = secureStorage, now = Date.now }: Props) {
  const contextApi = useApi();
  const api = injectedApi ?? contextApi;
  const auth = useMemo(() => authApi(api), [api]);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(null);
  const [pendingLogin, setPendingLogin] = useState<PendingLogin | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const refreshing = useRef(false);

  // Follow the store: 401s from any request clear it, and so do limits.
  useEffect(() => {
    const unsubscribe = store.subscribe((next, reason) => {
      setSession(next);
      setStatus(next ? 'signedIn' : 'signedOut');
      if (!next && reason && reason !== 'logout') setSignOutReason(reason);
    });
    let cancelled = false;
    void (async () => {
      const [loaded, id] = await Promise.all([store.load(), getDeviceId(storage)]);
      if (cancelled) return;
      setDeviceId(id);
      setSession(loaded);
      setStatus(loaded ? 'signedIn' : 'signedOut');
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [store, storage]);

  const maintain = useCallback(async () => {
    const current = store.get();
    if (!current) return;
    if (await store.enforceLimits()) return;
    if (refreshing.current) return;
    if (current.tokenExpiresAt - now() > REFRESH_WHEN_LEFT_MS) return;
    refreshing.current = true;
    try {
      const result = await auth.refresh();
      await store.replaceToken(result.accessToken);
    } catch {
      // Network: try again next minute. 401: the client already signed out.
    } finally {
      refreshing.current = false;
    }
  }, [auth, store, now]);

  // Check limits and refresh every minute, and whenever the app comes back.
  useEffect(() => {
    if (status !== 'signedIn') return;
    const timer = setInterval(() => void maintain(), CHECK_EVERY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void maintain();
    });
    void maintain();
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [status, maintain]);

  const startLogin = useCallback(
    async (staffCode: string, password: string, totpCode?: string): Promise<StartLoginResult> => {
      const id = deviceId ?? (await getDeviceId(storage));
      const response = await auth.login({
        staffCode: staffCode.trim(),
        password,
        deviceId: id,
        ...(totpCode ? { totpCode } : {}),
      });
      if (isAwaitingCode(response)) {
        setPendingLogin({ ...response, staffCode: staffCode.trim() });
        return { kind: 'awaiting_code' };
      }
      setSignOutReason(null);
      await store.start(response.accessToken, response.staff, response.sessionId ?? null);
      return { kind: 'signed_in' };
    },
    [auth, deviceId, storage, store],
  );

  const verifyCode = useCallback(
    async (code: string) => {
      if (!pendingLogin) throw new Error('No login is waiting for a code');
      const response = await auth.verifyCode(pendingLogin.loginRequestId, code);
      setSignOutReason(null);
      setPendingLogin(null);
      await store.start(response.accessToken, response.staff, response.sessionId ?? null);
    },
    [auth, pendingLogin, store],
  );

  const logout = useCallback(async () => {
    try {
      if (store.get()) await auth.logout();
    } catch {
      // Offline or already ended: the phone forgets the session either way.
    }
    setSignOutReason(null);
    await store.clear('logout');
  }, [auth, store]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      session,
      signOutReason,
      pendingLogin,
      deviceId,
      startLogin,
      verifyCode,
      cancelPendingLogin: () => setPendingLogin(null),
      logout,
      touch: () => store.touch(),
    }),
    [status, session, signOutReason, pendingLogin, deviceId, startLogin, verifyCode, logout, store],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
