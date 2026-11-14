import { isApiError } from '@/api/errors';
import type { SignOutReason } from '@/auth/session';
import type { MessageKey } from '@/i18n';

/**
 * Turns the API's login refusals (src/common/auth/auth.service.ts) into the
 * agent's language. Unknown refusals fall back to `common.error` and the
 * screen shows the server's own sentence.
 */
export function loginErrorKey(error: unknown): MessageKey {
  if (!isApiError(error)) return 'common.error';
  if (error.isNetworkError) return 'common.networkError';
  if (error.status === 429) return 'fa01.tooManyTries';
  const m = error.message.toLowerCase();
  // Laboura Field is for field agents only (owner decision 14 Nov).
  if (m.includes('this app is for field agents')) return 'fa01.notForThisApp';
  if (m.includes('waiting for approval')) return 'fa01.devicePending';
  if (m.includes('locked')) return 'fa01.locked';
  if (m.includes('not active') || m.includes('cannot log in')) return 'fa01.accountInactive';
  if (m.includes('invalid staff code or password') || m.includes('not a login identifier')) return 'fa01.invalidCredentials';
  return 'common.error';
}

/** FA02 refusals: expired request vs wrong / used code. */
export function codeErrorKey(error: unknown): MessageKey {
  if (!isApiError(error)) return 'common.error';
  if (error.isNetworkError) return 'common.networkError';
  if (error.status === 429) return 'fa01.tooManyTries';
  const m = error.message.toLowerCase();
  if (m.includes('this app is for field agents')) return 'fa01.notForThisApp';
  if (m.includes('no longer approved')) return 'fa01.devicePending';
  if (m.includes('expired') || m.includes('refused') || m.includes('not found') || m.includes('request is')) return 'fa02.expired';
  if (m.includes('not valid') || m.includes('already been used')) return 'fa02.invalidCode';
  if (m.includes('locked')) return 'fa01.locked';
  if (m.includes('not active')) return 'fa01.accountInactive';
  return 'common.error';
}

export function sessionReasonKey(reason: SignOutReason): MessageKey | null {
  switch (reason) {
    case 'idle':
      return 'session.idle';
    case 'max_length':
      return 'session.max_length';
    case 'revoked':
      return 'session.revoked';
    case 'expired':
      return 'session.expired';
    case 'unauthorized':
      return 'session.unauthorized';
    default:
      return null;
  }
}
