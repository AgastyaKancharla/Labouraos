import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { ApiProvider } from '@/api/ApiProvider';
import type { CustomerApi } from '@/api/customerApi';
import type { CustomerAccount, OtpSent, ProfileKind, StepUpPurpose } from '@/api/types';
import { ACTIVE_PROFILE_KEY, AuthProvider } from '@/auth/AuthProvider';
import { SessionStore } from '@/auth/session';
import { I18nProvider, type Language } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';
import { formOptions } from './fixtures';

const unexpected = (name: string) =>
  jest
    .fn(async () => {
      throw new Error(`Unexpected API call in test: ${name}`);
    })
    .mockName(`unexpected:${name}`);

/** A CustomerApi where every call is a jest.fn; unmocked calls fail loudly. */
export function fakeApi(overrides: Partial<CustomerApi> = {}): jest.Mocked<CustomerApi> {
  const names: (keyof CustomerApi)[] = [
    'config', 'sendSignInOtp', 'verifySignInOtp', 'signInWithGoogle', 'signInWithApple', 'signOut', 'me', 'updateMe', 'setLastProfile',
    'sendPhoneOtp', 'verifyPhoneOtp', 'sendStepUp', 'startSignup', 'formOptions', 'ageCheck', 'registerJobSeeker', 'registerBusiness',
    'registerReferralPartner', 'sheetLink', 'home', 'createVacancy', 'confirmVacancy', 'requestCallback', 'deletionInfo', 'requestDeletion',
  ];
  const api = Object.fromEntries(names.map((n) => [n, unexpected(n)])) as unknown as jest.Mocked<CustomerApi>;
  // Harmless defaults most screens touch.
  api.config = jest.fn(async () => ({ googleSignIn: true, googleWebClientId: null, googleIosClientId: null, appleSignIn: false, otpTestMode: true }));
  api.formOptions = jest.fn(async () => formOptions);
  api.signOut = jest.fn(async () => undefined);
  api.setLastProfile = jest.fn(async (_profileId: string) => undefined);
  api.ageCheck = jest.fn(async (_dateOfBirth: string) => ({ adult: true }));
  api.startSignup = jest.fn(async (_kind: ProfileKind) => ({ existingProfileId: null as string | null }));
  api.sendStepUp = jest.fn(async (_purpose: StepUpPurpose, _resendOf?: string): Promise<OtpSent> => ({ requestId: 'step-1', resendAvailableAt: new Date(Date.now() + 30_000).toISOString(), resendsLeft: 3 }));
  for (const [key, value] of Object.entries(overrides)) {
    (api as unknown as Record<string, unknown>)[key] = jest.isMockFunction(value) ? value : jest.fn(value as (...args: unknown[]) => unknown);
  }
  return api;
}

interface Options {
  api?: jest.Mocked<CustomerApi>;
  /** Signed in as this account (GET /me answers it). Omit for signed out. */
  account?: CustomerAccount;
  activeProfileId?: string;
  language?: Language;
}

/** Renders a screen with every provider the app has, wired to a fake CustomerApi. */
export async function renderWithApp(ui: ReactElement, options: Options = {}) {
  const storage = createMemoryStore();
  const store = new SessionStore(storage);
  const api = options.api ?? fakeApi();
  if (options.account) {
    const account = options.account;
    if (api.me.getMockName().startsWith('unexpected:')) api.me = jest.fn(async () => account);
    await store.start('test-token');
  }
  if (options.activeProfileId) await storage.setItem(ACTIVE_PROFILE_KEY, options.activeProfileId);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const result = await render(
    <ApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <I18nProvider storage={storage} initialLanguage={options.language ?? 'en'}>
          <AuthProvider store={store} storage={storage}>
            {ui}
          </AuthProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ApiProvider>,
  );
  return { ...result, api, store, storage, queryClient };
}
