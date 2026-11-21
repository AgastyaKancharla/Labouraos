import type { ApiClient } from '@/api/client';
import { authApi } from '@/api/endpoints/auth';
import { isApiError } from '@/api/errors';
import type { KeyValueStore } from '@/lib/storage/types';
import { getDeviceId } from './device';
import { reasonFromMessage, type SessionStore, type SignOutReason } from './session';

/** renewed: a fresh token is in the store · ended: the server ended the session (store cleared with its reason) · failed: no answer, try later. */
export type RefreshOutcome = 'renewed' | 'ended' | 'failed';

/** One refresh at a time per store: the refresh token is single use, so two at once would end the session. */
const inflight = new WeakMap<SessionStore, Promise<RefreshOutcome>>();

/**
 * Gets a fresh access token for the kept session (decided 21 Nov: the apps
 * try to renew before signing out on a 401). Field agents use their
 * single-use refresh token, which also works after the token ran out while
 * the app was closed; the server refuses once its rules end the session (the
 * working day is over, the idle or 2-hour limit outside an open day, revoked)
 * and the store is cleared with that reason. Without a refresh token the
 * bearer refresh is used.
 */
export function refreshKeptSession(api: ApiClient, store: SessionStore, storage: KeyValueStore): Promise<RefreshOutcome> {
  const running = inflight.get(store);
  if (running) return running;
  const run = (async (): Promise<RefreshOutcome> => {
    const current = store.get();
    if (!current) return 'failed';
    const auth = authApi(api);
    try {
      if (current.refreshToken && current.sessionId) {
        const result = await auth.fieldRefresh({
          sessionId: current.sessionId,
          refreshToken: current.refreshToken,
          deviceId: await getDeviceId(storage),
        });
        await store.replaceToken(result.accessToken, result.refreshToken);
      } else {
        const result = await auth.refresh();
        await store.replaceToken(result.accessToken);
      }
      return 'renewed';
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        const body = error.body as { reason?: string; details?: { reason?: string } } | undefined;
        const given = body?.details?.reason ?? body?.reason;
        // 'expired': a renewal answer was lost on a weak network — sign in again with the password (drafts kept).
        const reason: SignOutReason =
          given === 'idle' || given === 'max_length' || given === 'expired' ? given : given ? 'revoked' : reasonFromMessage(error.message);
        await store.clear(reason);
        return 'ended';
      }
      return 'failed';
    }
  })();
  inflight.set(store, run);
  void run.finally(() => {
    if (inflight.get(store) === run) inflight.delete(store);
  });
  return run;
}
