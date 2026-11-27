import { installationId } from '@/auth/installation';
import { SessionStore } from '@/auth/session';
import { secureStorage } from '@/lib/storage';
import { createApiClient } from './client';
import { apiBaseUrl, apiMode } from './config';
import type { CustomerApi } from './customerApi';
import { CUSTOMER_API_PATH, liveCustomerApi, refreshSession } from './live';

/** The app's one session store, HTTP client and customer API. */
export const sessionStore = new SessionStore(secureStorage);

let refreshing: Promise<boolean> | null = null;

export const httpClient = createApiClient({
  baseUrl: `${apiBaseUrl()}${CUSTOMER_API_PATH}`,
  getToken: () => sessionStore.token(),
  getHeaders: async () => ({ 'X-Laboura-Installation': await installationId() }),
  // One refresh at a time, however many requests found the token expired.
  refresh: () => {
    refreshing ??= refreshSession(`${apiBaseUrl()}${CUSTOMER_API_PATH}`, sessionStore).finally(() => {
      refreshing = null;
    });
    return refreshing;
  },
  onUnauthorized: (_message, code) => {
    void sessionStore.clear(code === 'CUSTOMER_ACCOUNT_DELETED' ? 'deleted' : 'expired');
  },
});

/**
 * The real API, or — only in local development — the pretend server. The
 * `__DEV__ &&` lets the release bundler drop the pretend server entirely.
 */
export const defaultCustomerApi: CustomerApi =
  __DEV__ && apiMode() === 'mock'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('./mock') as typeof import('./mock')).mockCustomerApi({
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        persist: (require('./mockPersist') as typeof import('./mockPersist')).fileMockPersist('laboura-mock-server.json'),
      })
    : liveCustomerApi(httpClient);

export { ApiError, isApiError } from './errors';
export type { ApiClient, RequestOptions } from './client';
export type { CustomerApi } from './customerApi';
export * from './types';
