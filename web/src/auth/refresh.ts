import { getDeviceId } from './device';
import { reasonFromMessage, sessionStore, type SignOutReason } from './session';

/** renewed: a fresh token is in the store · ended: the server ended the session (store cleared) · failed: cannot renew (no refresh token, no answer). */
export type RefreshOutcome = 'renewed' | 'ended' | 'failed';

let inflight: Promise<RefreshOutcome> | null = null;

/**
 * Renews the tab's session with its single-use refresh token (decided 21 Nov:
 * the apps try to renew before signing out on a 401). Works also after the
 * 15-minute token ran out. One at a time: the token is single use. Plain
 * fetch, so the API client can call it without a loop.
 */
export function refreshSession(fetchImpl: typeof fetch = (...args) => fetch(...args)): Promise<RefreshOutcome> {
  if (inflight) return inflight;
  inflight = (async (): Promise<RefreshOutcome> => {
    const current = sessionStore.get();
    if (!current?.refreshToken || !current.sessionId) return 'failed';
    let response: Response;
    try {
      response = await fetchImpl('/auth/session/refresh', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: current.sessionId, refreshToken: current.refreshToken, deviceId: getDeviceId() }),
        credentials: 'same-origin',
      });
    } catch {
      return 'failed';
    }
    const body = (await response.json().catch(() => ({}))) as {
      accessToken?: string;
      refreshToken?: string;
      message?: string | string[];
      reason?: string;
      details?: { reason?: string };
    };
    if (response.ok && body.accessToken) {
      sessionStore.replaceToken(body.accessToken, body.refreshToken);
      return 'renewed';
    }
    if (response.status === 401) {
      const given = body.details?.reason ?? body.reason;
      const message = Array.isArray(body.message) ? body.message[0] : body.message;
      const reason: SignOutReason = given === 'idle' || given === 'max_length' ? given : given ? 'revoked' : reasonFromMessage(message);
      sessionStore.clear(reason, message);
      return 'ended';
    }
    return 'failed';
  })();
  const running = inflight;
  void running.finally(() => {
    if (inflight === running) inflight = null;
  });
  return running;
}
