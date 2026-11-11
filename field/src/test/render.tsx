import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { ApiProvider } from '@/api/ApiProvider';
import { createApiClient, type ApiClient } from '@/api/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { SessionStore, type StaffIdentity } from '@/auth/session';
import { OfflineQueue } from '@/device/offline-queue/queue';
import { OfflineQueueProvider } from '@/device/offline-queue/OfflineQueueProvider';
import { createMemoryQueueStore } from '@/device/offline-queue/types';
import { I18nProvider, type Language } from '@/i18n';
import { createMemoryStore } from '@/lib/storage';

/** A JWT the app can read (expiry only; tests never verify signatures). */
export function fakeToken(expiresAtMs = Date.now() + 15 * 60_000): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ sub: 'fa-1', role: 'field_agent', exp: Math.floor(expiresAtMs / 1000) })}.sig`;
}

export const kiran: StaffIdentity = { id: 'fa-1', code: 'FA-00017', name: 'Kiran Kumar', role: 'field_agent' };

export type FetchRoute = (url: string, init: RequestInit) => { status: number; body?: unknown } | undefined;

/** A fetch that answers from a function of (url, init); unmatched calls get 404. */
export function fakeFetch(route: FetchRoute) {
  return jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const answer = route(url, init) ?? { status: 404, body: { message: `No fake for ${url}` } };
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: async () => (answer.body === undefined ? '' : JSON.stringify(answer.body)),
    } as Response;
  });
}

interface Options {
  route?: FetchRoute;
  signedInAs?: StaffIdentity | null;
  language?: Language;
  queue?: OfflineQueue;
}

/**
 * Renders a screen with every provider the app has, wired to a fake API.
 * Returns the fake fetch, the session store and the API client so a test
 * can assert what was sent.
 */
export async function renderWithApp(ui: ReactElement, options: Options = {}) {
  const storage = createMemoryStore();
  const store = new SessionStore(storage);
  const fetchImpl = fakeFetch(options.route ?? (() => undefined));
  const api: ApiClient = createApiClient({
    baseUrl: 'https://api.test',
    getToken: () => store.token(),
    onUnauthorized: () => void store.clear('unauthorized'),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  if (options.signedInAs) await store.start(fakeToken(), options.signedInAs, 'sess-1');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  const queue = options.queue ?? new OfflineQueue({ store: createMemoryQueueStore(), send: async () => undefined });
  const result = await render(
    <ApiProvider api={api}>
    <QueryClientProvider client={queryClient}>
      <I18nProvider storage={storage} initialLanguage={options.language ?? 'en'}>
        <AuthProvider store={store} storage={storage}>
          <OfflineQueueProvider queue={queue}>{ui}</OfflineQueueProvider>
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
    </ApiProvider>,
  );
  return { ...result, fetchImpl, store, api, queue, queryClient };
}
