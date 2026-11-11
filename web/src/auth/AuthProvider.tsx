import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi, type TokenResponse } from './authApi';
import { isStaffRole } from './roles';
import { sessionFromToken, sessionStore, type Session, type SignOutReason } from './session';

/**
 * Holds the signed-in staff session and keeps it alive while the person is
 * working:
 *
 * - The 15-minute token is refreshed a minute before it expires, but only if
 *   the person has touched the page (mouse, keys, touch, scroll) within the
 *   last 60 minutes — so an unattended screen signs out after 60 idle
 *   minutes, as the guide requires. (Every API call counts as activity on
 *   the server, so the browser has to enforce the idle rule for refreshes.)
 * - The API's 2-hour limit, a revoked session or a new login elsewhere make
 *   the refresh fail; the person lands on sign-in with the reason.
 */
export const IDLE_LIMIT_MS = 60 * 60 * 1000;
export const REFRESH_BEFORE_EXPIRY_MS = 60 * 1000;

interface AuthValue {
  session: Session | null;
  /** Why the last session ended (shown once on the sign-in screen). */
  signOutReason: SignOutReason | null;
  clearSignOutReason: () => void;
  /** Store a token response from /auth/login or /auth/login/verify-code. */
  acceptLogin: (response: TokenResponse) => Session | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(() => sessionStore.get());
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(null);
  const lastActivity = useRef(Date.now());

  useEffect(
    () =>
      sessionStore.subscribe((next, reason) => {
        setSession(next);
        if (!next) {
          queryClient.clear();
          if (reason && reason !== 'logout') setSignOutReason(reason);
        }
      }),
    [queryClient],
  );

  // Track activity for the idle rule.
  useEffect(() => {
    const mark = () => {
      lastActivity.current = Date.now();
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, mark, { passive: true, capture: true });
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, mark, { capture: true });
    };
  }, []);

  // Refresh shortly before expiry, or end the session when idle.
  useEffect(() => {
    if (!session || session.totpSetupOnly) return;
    const wait = Math.max(1000, session.expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS);
    const timer = setTimeout(async () => {
      if (Date.now() - lastActivity.current >= IDLE_LIMIT_MS) {
        sessionStore.clear('idle');
        return;
      }
      try {
        const { accessToken } = await authApi.refresh();
        sessionStore.replaceToken(accessToken);
      } catch {
        // apiRequest already cleared the session with the API's reason on 401;
        // anything else (network) leaves the token to expire normally.
        if (sessionStore.get() && sessionStore.get()!.expiresAt <= Date.now()) sessionStore.clear('expired');
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [session]);

  const acceptLogin = useCallback((response: TokenResponse) => {
    if (!isStaffRole(response.staff.role)) return null;
    const next = sessionFromToken(response.accessToken, {
      id: response.staff.id,
      code: response.staff.code,
      name: response.staff.name,
      email: response.staff.email,
      role: response.staff.role,
    });
    if (!next) return null;
    lastActivity.current = Date.now();
    setSignOutReason(null);
    sessionStore.set(next);
    return next;
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (sessionStore.token()) await authApi.logout();
    } catch {
      /* the session ends locally either way */
    }
    sessionStore.clear('logout');
    setSignOutReason('logout');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ session, signOutReason, clearSignOutReason: () => setSignOutReason(null), acceptLogin, signOut }),
    [session, signOutReason, acceptLogin, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
