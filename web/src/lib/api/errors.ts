/**
 * The error body every API failure returns (GlobalExceptionFilter):
 *   { statusCode, message, details?, requestId?, timestamp }
 * `message` is usually a string; Nest validation can make it a string[].
 * 5xx responses always say "Internal server error" and carry a requestId to
 * quote to support.
 */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  details?: unknown;
  requestId?: string;
  timestamp?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly messages: string[];
  readonly details: unknown;
  readonly requestId: string | undefined;
  /** True when the request never got a response (offline, DNS, CORS…). */
  readonly isNetworkError: boolean;

  constructor(opts: {
    status: number;
    messages: string[];
    details?: unknown;
    requestId?: string;
    isNetworkError?: boolean;
  }) {
    super(opts.messages[0] ?? `Request failed (${opts.status})`);
    this.name = 'ApiError';
    this.status = opts.status;
    this.messages = opts.messages;
    this.details = opts.details;
    this.requestId = opts.requestId;
    this.isNetworkError = opts.isNetworkError ?? false;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'statusCode' in value && 'message' in value;
}

export function apiErrorFromBody(status: number, body: unknown): ApiError {
  if (isErrorBody(body)) {
    const messages = Array.isArray(body.message) ? body.message.map(String) : [String(body.message)];
    return new ApiError({ status, messages, details: body.details, requestId: body.requestId });
  }
  return new ApiError({ status, messages: [`Request failed (${status})`] });
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
