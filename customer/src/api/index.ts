import { SessionStore } from '@/auth/session';
import { secureStorage } from '@/lib/storage';
import { createApiClient } from './client';
import { apiBaseUrl, apiMode } from './config';
import type { CustomerApi } from './customerApi';
import { liveCustomerApi } from './live';
import { mockCustomerApi } from './mock';

/** The app's one session store, HTTP client and customer API. */
export const sessionStore = new SessionStore(secureStorage);

export const httpClient = createApiClient({
  baseUrl: apiBaseUrl(),
  getToken: () => sessionStore.token(),
  onUnauthorized: () => {
    void sessionStore.clear('expired');
  },
});

export const defaultCustomerApi: CustomerApi = apiMode() === 'mock' ? mockCustomerApi() : liveCustomerApi(httpClient);

export { ApiError, isApiError } from './errors';
export type { ApiClient, RequestOptions } from './client';
export type { CustomerApi } from './customerApi';
export * from './types';
