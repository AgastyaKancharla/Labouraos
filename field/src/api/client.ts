import { ApiError, apiErrorFromBody, networkError } from './errors';

export type QueryValue = string | number | boolean | null | undefined;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /** JSON body. Mutually exclusive with `form`. */
  body?: unknown;
  /** Multipart body (photos). */
  form?: FormData;
  query?: Record<string, QueryValue | QueryValue[]>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Send the staff token (default true). Login endpoints pass false. */
  auth?: boolean;
  /** Abort after this many ms (default 20 s — field signal is slow, not dead). */
  timeoutMs?: number;
}

export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | null;
  /** Called when an authenticated request gets 401: the session is over. */
  onUnauthorized: (message: string) => void;
  fetchImpl?: typeof fetch;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<T>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  delete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<T>;
}

export const DEFAULT_TIMEOUT_MS = 20_000;

export function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  if (!path.startsWith('/')) throw new Error(`API paths start with "/": ${path}`);
  const parts: string[] = [];
  if (query) {
    for (const [key, raw] of Object.entries(query)) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        if (v !== undefined && v !== null && v !== '') {
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
        }
      }
    }
  }
  return `${baseUrl}${path}${parts.length ? `?${parts.join('&')}` : ''}`;
}

/**
 * The one way screens talk to the Nest API: JSON in and out, the staff JWT
 * attached, errors thrown as ApiError. A 401 on an authenticated request
 * ends the session (onUnauthorized) — screens never handle 401 themselves.
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  const doFetch = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, form, query, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
    const token = auth ? config.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const outer = options.signal;
    const onOuterAbort = () => controller.abort();
    outer?.addEventListener('abort', onOuterAbort);

    let response: Response;
    try {
      response = await doFetch(buildUrl(config.baseUrl, path, query), {
        method,
        headers,
        body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
        signal: controller.signal,
      });
    } catch (err) {
      if (outer?.aborted) throw err;
      throw networkError();
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    }

    const text = await response.text().catch(() => '');
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
      if (response.status === 401 && token) config.onUnauthorized(error.message);
      throw error;
    }
    return parsed as T;
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body: options?.form ? undefined : (body ?? {}) }),
    put: (path, body, options) => request(path, { ...options, method: 'PUT', body: body ?? {} }),
    patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body: body ?? {} }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  };
}

export { ApiError };
