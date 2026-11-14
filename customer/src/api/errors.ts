/**
 * Every failed API call throws an ApiError. Screens show `error.message`
 * (already readable) or map known cases to their own i18n keys.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly messages: string[];
  readonly isNetworkError: boolean;
  readonly body: unknown;

  constructor(init: { status: number; messages: string[]; isNetworkError?: boolean; body?: unknown }) {
    super(init.messages[0] ?? `Request failed (${init.status})`);
    this.name = 'ApiError';
    this.status = init.status;
    this.messages = init.messages;
    this.isNetworkError = init.isNetworkError ?? false;
    this.body = init.body;
  }

  /** True for "no signal / server unreachable" — the request may be retried later. */
  get isRetryable(): boolean {
    return this.isNetworkError || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** Nest error bodies look like { statusCode, message: string | string[], error }. */
export function apiErrorFromBody(status: number, body: unknown): ApiError {
  let messages: string[] = [];
  if (body && typeof body === 'object' && 'message' in body) {
    const raw = (body as { message: unknown }).message;
    if (Array.isArray(raw)) messages = raw.map(String);
    else if (typeof raw === 'string') messages = [raw];
  } else if (typeof body === 'string' && body.trim()) {
    messages = [body.trim().slice(0, 300)];
  }
  if (messages.length === 0) messages = [`Request failed (${status})`];
  return new ApiError({ status, messages, body });
}

export function networkError(): ApiError {
  return new ApiError({
    status: 0,
    messages: ['Could not reach Laboura. Check the signal and try again.'],
    isNetworkError: true,
  });
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
