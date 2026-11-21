import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { sessionStore as defaultStore } from '@/api';
import { useApi } from '@/api/ApiProvider';
import type { ApiClient } from '@/api/client';
import {
  authApi,
  FIELD_APP_ONLY_MESSAGE,
  isAwaitingCode,
  isSetupRequired,
  type AwaitingCodeResponse,
  type PasswordResetNotice,
  type SetupRequiredResponse,
} from '@/api/endpoints/auth';
import { ApiError, isApiError } from '@/api/errors';
import { attendanceApi } from '@/api/endpoints/attendance';
import { clearAllDrafts, setDraftOwner } from '@/lib/formDraft';
import { secureStorage, type KeyValueStore } from '@/lib/storage';
import { getDeviceId } from './device';
import { SessionStore, tokenNeedsRefresh, type Session, type SignOutReason } from './session';
import { refreshKeptSession } from './refresh';

/** Refresh the 15-minute access token when less than this is left. */
export const REFRESH_WHEN_LEFT_MS = 5 * 60 * 1000;
export const CHECK_EVERY_MS = 60 * 1000;
/** While the app is open in front of the agent it tells attendance he is present this often (decided 21 Nov). */
export const PRESENCE_EVERY_MS = 60 * 1000;
/** Taps are sent as activity at most this often. */
export const ACTIVITY_EVERY_MS = 60 * 1000;
/** After "the day is not open" (before Log in, after Log out) heartbeats wait this long. */
const DAY_CLOSED_PAUSE_MS = 5 * 60 * 1000;

/**
 * Sign-outs after which what the agent typed is thrown away (fix list A6):
 * Log out, and a session ended by the office or refused by the server. After
 * the 1-hour idle or 2-hour limit his drafts wait for him (they are kept
 * under his staff id, so nobody else signing in sees them).
 */
const CLEARS_DRAFTS: readonly SignOutReason[] = ['logout', 'revoked', 'unauthorized'];

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface PendingLogin extends AwaitingCodeResponse {
  staffCode: string;
  /** The phone the login was started on; the code is checked against it. */
  deviceId: string;
}

export type StartLoginResult = { kind: 'awaiting_code' } | { kind: 'signed_in' } | { kind: 'setup_required' };

/** First login with a temporary password: the set-up steps on this phone (no session). */
export interface PendingSetup extends SetupRequiredResponse {
  deviceId: string;
  /** What was typed at sign-in, so the new password can be checked against it before sending. */
  temporary: string;
}

interface AuthValue {
  status: AuthStatus;
  session: Session | null;
  /** Why the last session ended (shown on the sign-in screen). Cleared on the next login. */
  signOutReason: SignOutReason | null;
  pendingLogin: PendingLogin | null;
  /** First login: set by startLogin when the temporary password was recognised. */
  pendingSetup: PendingSetup | null;
  cancelSetup: () => void;
  /** Shown once on Home after the first sign-in following a password reset. */
  resetNotice: PasswordResetNotice | null;
  dismissResetNotice: () => void;
  deviceId: string | null;
  /** FA01: staff code + password. Laboura Field is for field agents only. */
  startLogin: (staffCode: string, password: string) => Promise<StartLoginResult>;
  /** FA02: the 6-digit code read out by the Team Lead. */
  verifyCode: (code: string) => Promise<void>;
  cancelPendingLogin: () => void;
  logout: () => Promise<void>;
  /** Call on any tap: recorded on the phone and sent to attendance as activity (at most once a minute). */
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
  const [pendingSetup, setPendingSetup] = useState<PendingSetup | null>(null);
  const [resetNotice, setResetNotice] = useState<PasswordResetNotice | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  /**
   * Gets a fresh access token (shared with the API client's renew-on-401, so
   * the single-use refresh token is never used twice at once). The server
   * refuses once its rules end the session and the phone shows that reason;
   * with no signal it tries again next minute.
   */
  const refreshNow = useCallback(async () => {
    if (!store.get()) return;
    await refreshKeptSession(api, store, storage);
  }, [api, store, storage]);

  // Follow the store: 401s from any request clear it, and so do limits.
  useEffect(() => {
    const unsubscribe = store.subscribe((next, reason) => {
      setSession(next);
      setStatus(next ? 'signedIn' : 'signedOut');
      if (!next && reason && reason !== 'logout') setSignOutReason(reason);
      if (!next && reason && CLEARS_DRAFTS.includes(reason)) clearAllDrafts();
    });
    let cancelled = false;
    void (async () => {
      const [stored, id] = await Promise.all([store.load(), getDeviceId(storage)]);
      if (cancelled) return;
      setDeviceId(id);
      // A session kept from before Laboura Field became field-agent-only (a CEO
      // signed in with the authenticator) is dropped: the server refuses it anyway.
      let loaded = stored;
      if (loaded && loaded.staff.role !== 'field_agent') {
        await store.clear('logout');
        loaded = null;
      }
      // Reopened after a while: restore the session before any screen asks
      // for data with a token that has run out.
      if (loaded && tokenNeedsRefresh(loaded, now(), REFRESH_WHEN_LEFT_MS)) await refreshNow();
      if (cancelled) return;
      const current = store.get();
      setSession(current);
      setStatus(current ? 'signedIn' : 'signedOut');
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // Runs once per store: refreshNow and now are stable for a given store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, storage]);

  const maintain = useCallback(async () => {
    const current = store.get();
    if (!current) return;
    if (await store.enforceLimits()) return;
    if (!tokenNeedsRefresh(current, now(), REFRESH_WHEN_LEFT_MS)) return;
    await refreshNow();
  }, [store, now, refreshNow]);

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

  // Present while the app is open in front of the agent (decided 21 Nov): a
  // heartbeat about once a minute; taps go as activity (see touch below).
  const heartbeatPausedUntil = useRef(0);
  const lastActivityBeat = useRef(0);
  const beat = useCallback(
    (kind: 'presence' | 'activity') => {
      if (!store.get() || now() < heartbeatPausedUntil.current) return;
      attendanceApi(api)
        .heartbeat(kind)
        .catch((error: unknown) => {
          // The day is not open (before Log in, after Log out): wait a while.
          if (isApiError(error) && error.status === 400) heartbeatPausedUntil.current = now() + DAY_CLOSED_PAUSE_MS;
        });
    },
    [api, store, now],
  );
  useEffect(() => {
    if (status !== 'signedIn') return;
    heartbeatPausedUntil.current = 0;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') beat('presence');
    }, PRESENCE_EVERY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        heartbeatPausedUntil.current = 0;
        beat('presence');
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [status, beat]);

  const touch = useCallback(() => {
    store.touch();
    const at = now();
    if (at - lastActivityBeat.current < ACTIVITY_EVERY_MS) return;
    lastActivityBeat.current = at;
    beat('activity');
  }, [store, now, beat]);

  const startLogin = useCallback(
    async (staffCode: string, password: string): Promise<StartLoginResult> => {
      const id = deviceId ?? (await getDeviceId(storage));
      const response = await auth.login({
        staffCode: staffCode.trim(),
        password,
        deviceId: id,
      });
      if (isSetupRequired(response)) {
        setPendingSetup({ ...response, deviceId: id, temporary: password });
        return { kind: 'setup_required' };
      }
      if (isAwaitingCode(response)) {
        setPendingLogin({ ...response, staffCode: staffCode.trim(), deviceId: id });
        return { kind: 'awaiting_code' };
      }
      // Field agents always get a login code step; a token straight away would be
      // another role, which Laboura Field never keeps (owner decision 14 Nov).
      if (response.staff.role !== 'field_agent') {
        throw new ApiError({ status: 401, messages: [FIELD_APP_ONLY_MESSAGE] });
      }
      setSignOutReason(null);
      await store.start(response.accessToken, response.staff, response.sessionId ?? null, response.refreshToken ?? null);
      return { kind: 'signed_in' };
    },
    [auth, deviceId, storage, store],
  );

  const verifyCode = useCallback(
    async (code: string) => {
      if (!pendingLogin) throw new Error('No login is waiting for a code');
      // The code works only for this phone and this sign-in (proof from the login answer).
      const response = await auth.verifyCode(
        pendingLogin.loginRequestId,
        code,
        pendingLogin.deviceId,
        pendingLogin.loginRequestProof,
      );
      setSignOutReason(null);
      setPendingLogin(null);
      setResetNotice(response.passwordResetNotice ?? null);
      await store.start(response.accessToken, response.staff, response.sessionId ?? null, response.refreshToken ?? null);
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
    clearAllDrafts();
    await store.clear('logout');
  }, [auth, store]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      session,
      signOutReason,
      pendingLogin,
      pendingSetup,
      cancelSetup: () => setPendingSetup(null),
      resetNotice: session ? resetNotice : null,
      dismissResetNotice: () => setResetNotice(null),
      deviceId,
      startLogin,
      verifyCode,
      cancelPendingLogin: () => setPendingLogin(null),
      logout,
      touch,
    }),
    [status, session, signOutReason, pendingLogin, pendingSetup, resetNotice, deviceId, startLogin, verifyCode, logout, touch],
  );

  // Drafts belong to the signed-in agent: set before the screens below read theirs.
  setDraftOwner(session?.staff.id ?? store.get()?.staff.id ?? null);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
