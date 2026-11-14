import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import { sessionStore as appSessionStore } from '@/api/index';
import type { AuthResult, CustomerAccount, ProfileSummary } from '@/api/types';
import { clearAllDrafts } from '@/lib/drafts';
import { secureStorage, type KeyValueStore } from '@/lib/storage';
import { googleSignOut } from './google';
import type { SessionStore, SignedOutReason } from './session';

export const ACTIVE_PROFILE_KEY = 'laboura_active_profile';

type Status = 'loading' | 'signed_out' | 'signed_in';

interface AuthValue {
  status: Status;
  /** Null while signed out, or when /me could not be loaded (see accountError). */
  account: CustomerAccount | null;
  accountError: unknown;
  signedOutReason: SignedOutReason | null;
  /** After any sign-in method: keep the tokens and the account. */
  completeSignIn: (result: AuthResult) => Promise<void>;
  /** After a change on the server (phone verified, profile added). */
  setAccount: (account: CustomerAccount) => void;
  refreshAccount: () => Promise<CustomerAccount | null>;
  signOut: (reason?: SignedOutReason) => Promise<void>;
  /** The profile Home shows (remembered on the phone). */
  activeProfile: ProfileSummary | null;
  setActiveProfileId: (id: string) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

interface Props {
  children: ReactNode;
  store?: SessionStore;
  storage?: KeyValueStore;
}

/**
 * The customer's sign-in state. On start it reads the saved tokens and loads
 * the account from the server (never from the phone). A 401 anywhere signs
 * the person out and the sign-in screen says why.
 */
export function AuthProvider({ children, store = appSessionStore, storage = secureStorage }: Props) {
  const api = useCustomerApi();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [account, setAccountState] = useState<CustomerAccount | null>(null);
  const [accountError, setAccountError] = useState<unknown>(null);
  const [signedOutReason, setSignedOutReason] = useState<SignedOutReason | null>(null);
  const [activeProfileId, setActiveId] = useState<string | null>(null);
  const mounted = useRef(true);

  const loadAccount = useCallback(async (): Promise<CustomerAccount | null> => {
    try {
      const me = await api.me();
      if (!mounted.current) return me;
      setAccountState(me);
      setAccountError(null);
      return me;
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        await store.clear('expired');
        return null;
      }
      if (mounted.current) setAccountError(err);
      return null;
    }
  }, [api, store]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = store.subscribe((session, reason) => {
      if (!session) {
        setAccountState(null);
        setSignedOutReason(reason ?? 'signed_out');
        setStatus('signed_out');
        queryClient.clear();
      }
    });
    void (async () => {
      const savedProfile = await storage.getItem(ACTIVE_PROFILE_KEY);
      if (savedProfile && mounted.current) setActiveId(savedProfile);
      const session = await store.load();
      if (!mounted.current) return;
      if (!session) {
        setStatus('signed_out');
        return;
      }
      setStatus('signed_in');
      await loadAccount();
    })();
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [store, storage, loadAccount, queryClient]);

  const completeSignIn = useCallback(
    async (result: AuthResult) => {
      await store.start(result.accessToken, result.refreshToken ?? null);
      setAccountState(result.account);
      setAccountError(null);
      setSignedOutReason(null);
      setStatus('signed_in');
    },
    [store],
  );

  const setActiveProfileId = useCallback(
    (id: string) => {
      setActiveId(id);
      void storage.setItem(ACTIVE_PROFILE_KEY, id);
      // Remembered on the server too, for the next sign-in on another phone (PUT /me/last-profile).
      void api.setLastProfile(id).catch(() => undefined);
    },
    [storage, api],
  );

  const signOut = useCallback(
    async (reason: SignedOutReason = 'signed_out') => {
      if (reason === 'signed_out') await api.signOut().catch(() => undefined);
      await googleSignOut();
      await clearAllDrafts(storage);
      await storage.removeItem(ACTIVE_PROFILE_KEY);
      setActiveId(null);
      await store.clear(reason);
      setStatus('signed_out');
      setAccountState(null);
      setSignedOutReason(reason);
    },
    [api, store, storage],
  );

  const activeProfile = useMemo(() => {
    const profiles = account?.profiles ?? [];
    return profiles.find((p) => p.id === activeProfileId) ?? profiles.find((p) => p.id === account?.lastProfileId) ?? profiles[0] ?? null;
  }, [account, activeProfileId]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      account,
      accountError,
      signedOutReason,
      completeSignIn,
      setAccount: setAccountState,
      refreshAccount: loadAccount,
      signOut,
      activeProfile,
      setActiveProfileId,
    }),
    [status, account, accountError, signedOutReason, completeSignIn, loadAccount, signOut, activeProfile, setActiveProfileId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
