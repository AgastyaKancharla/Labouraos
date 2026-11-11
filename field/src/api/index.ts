import { reasonFromMessage, SessionStore } from '@/auth/session';
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
});

export { ApiError, isApiError } from './errors';
export type { ApiClient, RequestOptions } from './client';
