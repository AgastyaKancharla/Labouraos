import { isApiError } from '@/api/errors';
import type { MessageKey } from '@/i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * What to show for a failed link-endpoint call. The link endpoints answer
 * with English messages written for the person (the link pages show them),
 * so the same rules as web/src/screens/public/shared/ui.tsx `problemKey`
 * apply: known kinds get the app's words, anything else shows the server's
 * message.
 */
export function stepProblemKey(error: unknown): MessageKey {
  if (!isApiError(error)) return 'verr.generic';
  if (error.isNetworkError) return 'verr.offline';
  if (error.status === 429) return 'verr.tooMany';
  const message = error.message.toLowerCase();
  // A possible match with a banned person is being checked: a neutral message, never "ban" (rev 181, H2).
  if (error.status === 409 && message.includes('being checked by our team')) return 'verr.underReview';
  if (/\b(otp|code)\b/.test(message)) return 'verr.code';
  if (message.includes('expired')) return 'verr.expired';
  if (message.includes('already been used') || message.includes('no longer awaiting') || message.includes('no longer valid')) return 'verr.used';
  if (message.includes('revoked')) return 'verr.replaced';
  if (error.status === 404 || message.includes('not found') || message.includes('invalid') || message.includes('valid ')) return 'verr.invalid';
  if (error.status >= 500) return 'verr.server';
  return 'verr.generic';
}

export function stepErrorText(t: T, error: unknown): string {
  const key = stepProblemKey(error);
  if (key === 'verr.generic' && isApiError(error) && error.message && !error.isNetworkError) return error.message;
  return t(key);
}
