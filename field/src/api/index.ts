import { reasonFromMessage, SessionStore } from '@/auth/session';
import { refreshKeptSession } from '@/auth/refresh';
import { secureStorage } from '@/lib/storage';
import { createApiClient } from './client';
import { apiBaseUrl } from './config';

/** The app's one session store and API client. */
export const sessionStore = new SessionStore(secureStorage);

export const api = createApiClient({
  baseUrl: apiBaseUrl(),
  getToken: () => sessionStore.token(),
  onUnauthorized: (message) => {
    void sessionStore.clear(reasonFromMessage(message));
  },
  // Renew before signing out on a 401 (decided 21 Nov).
  refreshSession: () => refreshKeptSession(api, sessionStore, secureStorage),
});

export { ApiError, isApiError } from './errors';
export type { ApiClient, RequestOptions } from './client';
