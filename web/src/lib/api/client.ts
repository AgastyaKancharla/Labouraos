import { reasonFromMessage, sessionStore } from '../../auth/session';
import { ApiError, apiErrorFromBody } from './errors';
import { announceTestMode } from './testMode';

/**
 * The one way screens talk to the Nest API. Same origin (the app is served
 * by the API at /app, and Vite proxies in development), JSON in and out,
 * the staff JWT attached, errors thrown as ApiError.
 *
 * A 401 on an authenticated request ends the session: the store is cleared
 * and the app shows the sign-in screen with the reason (idle, 2-hour limit,
 * revoked…). Screens never handle 401 themselves.
 */
export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue | QueryValue[]>;
  signal?: AbortSignal;
  /** Send the staff token (default true). Login endpoints pass false. */
  auth?: boolean;
  /** Use this token instead of the session's (TOTP enrolment). */
  token?: string;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  if (!path.startsWith('/')) throw new Error(`API paths start with "/": ${path}`);
  const params = new URLSearchParams();
  if (query) {
    for (const [key, raw] of Object.entries(query)) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) if (v !== undefined && v !== null && v !== '') params.append(key, String(v));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, auth = true } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = options.token ?? (auth ? sessionStore.token() : null);
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError({
      status: 0,
      messages: ['Could not reach Laboura. Check the internet connection and try again.'],
      isNetworkError: true,
    });
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const error = apiErrorFromBody(response.status, parsed);
    if (response.status === 401 && token && auth && !options.token) {
      sessionStore.clear(reasonFromMessage(error.message), error.message);
    }
    throw error;
  }
  announceTestMode(parsed);
  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body: body ?? {} }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
