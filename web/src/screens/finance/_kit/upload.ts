import { sessionStore } from '../../../auth/session';
import { ApiError, apiErrorFromBody } from '../../../lib/api/errors';

/**
 * Sends a form with a file (the bill) to the API with the staff token. The
 * shared client speaks JSON only; uploads go through here.
 */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const token = sessionStore.token();
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      body: form,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError({ status: 0, messages: ['Could not reach Laboura. Check the internet connection and try again.'], isNetworkError: true });
  }
  const text = await response.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!response.ok) throw apiErrorFromBody(response.status, parsed);
  return parsed as T;
}

/** Opens a file the API serves only with the staff token (a bill) in a new tab. */
export async function openWithToken(path: string): Promise<void> {
  const token = sessionStore.token();
  const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'same-origin' });
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw apiErrorFromBody(response.status, body);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
