import { getDeviceId } from './device';
import { reasonFromMessage, sessionStore, type SignOutReason } from './session';

/** renewed: a fresh token is in the store · ended: the server ended the session (store cleared) · failed: cannot renew (no refresh token, no answer). */
export type RefreshOutcome = 'renewed' | 'ended' | 'failed';

let inflight: Promise<RefreshOutcome> | null = null;

/** Before signing out on a refused renewal, wait this long for another tab's renewed token (laptop waking with two tabs). */
export const SHARED_TOKEN_WAIT_MS = 2000;

/** True when the stored refresh token changes from `old` within `waitMs` (another tab shared its renewal). */
function sharedTokenArrives(old: string, waitMs: number): Promise<boolean> {
  const changed = () => {
    const now = sessionStore.get()?.refreshToken;
    return Boolean(now && now !== old);
  };
  if (changed()) return Promise.resolve(true);
  if (waitMs <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      resolve(value);
    };
    const stop = sessionStore.subscribe(() => {
      if (changed()) finish(true);
    });
    const timer = setTimeout(() => finish(changed()), waitMs);
  });
}

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
      shareToken();
      return 'renewed';
    }
    // Another tab renewed first and its new token reached (or is about to reach) this tab.
    if (response.status === 401 && (await sharedTokenArrives(current.refreshToken, SHARED_TOKEN_WAIT_MS))) return 'renewed';
    if (response.status === 401) {
      const given = body.details?.reason ?? body.reason;
      const message = Array.isArray(body.message) ? body.message[0] : body.message;
      const reason: SignOutReason =
        given === 'idle' || given === 'max_length' || given === 'expired' ? given : given ? 'revoked' : reasonFromMessage(message);
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

/**
 * Tabs of the same session share renewed tokens (21 Nov): a tab that copied
 * the session (opened from a link) would otherwise present a refresh token
 * the first tab already used, and be signed out. BroadcastChannel where the
 * browser has it; nothing otherwise (the bearer refresh still keeps both alive).
 */
const CHANNEL = 'laboura-session';

interface SharedToken {
  sessionId: string;
  token: string;
  refreshToken: string | null;
}

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  } catch {
    return null;
  }
}

/** Tells the other tabs of this session about the token just renewed here. */
export function shareToken(): void {
  const current = sessionStore.get();
  if (!current?.sessionId) return;
  const ch = channel();
  if (!ch) return;
  const message: SharedToken = { sessionId: current.sessionId, token: current.token, refreshToken: current.refreshToken ?? null };
  ch.postMessage(message);
  ch.close();
}

/** Takes in tokens other tabs of the same session renewed. Returns the stop function. */
export function listenForSharedTokens(): () => void {
  const ch = channel();
  if (!ch) return () => undefined;
  ch.onmessage = (event: MessageEvent<SharedToken>) => {
    const data = event.data;
    const current = sessionStore.get();
    if (!data || !current || data.sessionId !== current.sessionId || data.token === current.token) return;
    sessionStore.replaceToken(data.token, data.refreshToken ?? undefined);
  };
  return () => ch.close();
}
