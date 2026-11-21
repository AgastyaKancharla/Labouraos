import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi, type PasswordResetNotice, type TokenResponse } from './authApi';
import { isStaffRole } from './roles';
import { sessionFromToken, sessionStore, type Session, type SignOutReason } from './session';
import { refreshSession } from './refresh';

/**
 * Holds the signed-in staff session and keeps it alive while the person is
 * working:
 *
 * - The 15-minute token is renewed a minute before it expires with the
 *   single-use refresh token (POST /auth/session/refresh, decided 21 Nov), and
 *   again on any 401 before signing out (lib/api/client.ts).
 * - The server decides how long the session lasts: the working day while the
 *   attendance day is open on this approved device (up to the end of the
 *   shift + 2 hours), otherwise 1 hour idle / 2 hours at most. When it ends
 *   the renewal is refused and the person lands on sign-in with the reason.
 *   The tab no longer signs out by its own idle clock: an open console during
 *   the working day stays signed in.
 */
export const REFRESH_BEFORE_EXPIRY_MS = 60 * 1000;

interface AuthValue {
  session: Session | null;
  /** Why the last session ended (shown once on the sign-in screen). */
  signOutReason: SignOutReason | null;
  clearSignOutReason: () => void;
  /** Store a token response from /auth/login or /auth/login/verify-code. */
  acceptLogin: (response: TokenResponse) => Session | null;
  signOut: () => Promise<void>;
  /** Shown once after the first sign-in following a password reset ("Your password was reset on … approved by …"). */
  resetNotice: PasswordResetNotice | null;
  dismissResetNotice: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(() => sessionStore.get());
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(null);
  const [resetNotice, setResetNotice] = useState<PasswordResetNotice | null>(null);

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

  // Renew shortly before expiry. A session from before 21 Nov without a
  // refresh token uses the bearer refresh while its token still works.
  useEffect(() => {
    if (!session || session.totpSetupOnly) return;
    const wait = Math.max(1000, session.expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS);
    const timer = setTimeout(async () => {
      if (session.refreshToken && session.sessionId) {
        // 'ended' already signed out with the server's reason; 'failed' (offline) tries again on the next request.
        await refreshSession();
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
    setSignOutReason(null);
    setResetNotice(response.passwordResetNotice ?? null);
    sessionStore.set({ ...next, refreshToken: response.refreshToken ?? null, sessionId: response.sessionId ?? null });
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
    () => ({
      session,
      signOutReason,
      clearSignOutReason: () => setSignOutReason(null),
      acceptLogin,
      signOut,
      resetNotice: session ? resetNotice : null,
      dismissResetNotice: () => setResetNotice(null),
    }),
    [session, signOutReason, acceptLogin, signOut, resetNotice],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
