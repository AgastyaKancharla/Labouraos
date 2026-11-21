import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeJwt, mockApi, TEST_STAFF } from '../test/utils';
import { listenForSharedTokens, refreshSession, shareToken } from './refresh';
import { sessionStore } from './session';
import { BACKGROUND_HEADER, markUserActivity } from '../lib/api/userActivity';
import { apiRequest } from '../lib/api/client';

function start(refreshToken = 'r0') {
  sessionStore.set({ token: fakeJwt({ role: 'ceo' }, 15 * 60), staff: TEST_STAFF.ceo, expiresAt: Date.now() + 15 * 60_000, totpSetupOnly: false, refreshToken, sessionId: 's1' });
}

describe('two tabs and background polls (21 Nov hardening)', () => {
  afterEach(() => sessionStore.clear('logout'));

  it('a token renewed in one tab reaches the other tabs of the same session', async () => {
    start('r0');
    const stop = listenForSharedTokens();
    const fresh = fakeJwt({ role: 'ceo', code: 'other-tab' }, 15 * 60);
    const other = new BroadcastChannel('laboura-session');
    other.postMessage({ sessionId: 's1', token: fresh, refreshToken: 'r9' });
    await vi.waitFor(() => expect(sessionStore.get()?.token).toBe(fresh));
    expect(sessionStore.get()?.refreshToken).toBe('r9');
    // Another session's token is ignored.
    other.postMessage({ sessionId: 'someone-else', token: fakeJwt({ role: 'ceo' }, 60), refreshToken: 'zz' });
    await new Promise((r) => setTimeout(r, 30));
    expect(sessionStore.get()?.refreshToken).toBe('r9');
    other.close();
    stop();
  });

  it('shareToken posts this tab\'s token for the others', async () => {
    start('r5');
    const other = new BroadcastChannel('laboura-session');
    const got: unknown[] = [];
    other.onmessage = (event) => got.push(event.data);
    shareToken();
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got[0]).toMatchObject({ sessionId: 's1', refreshToken: 'r5' });
    other.close();
  });

  it('a refused renewal is not a sign-out when another tab already renewed meanwhile', async () => {
    start('r0');
    const fetchImpl = vi.fn(async () => {
      // The other tab's renewal arrives while this request is on its way.
      sessionStore.replaceToken(fakeJwt({ role: 'ceo', code: 'renewed' }, 15 * 60), 'r1');
      return new Response(JSON.stringify({ statusCode: 401, message: 'Session not found', reason: 'unknown' }), { status: 401 });
    });
    expect(await refreshSession(fetchImpl as unknown as typeof fetch)).toBe('renewed');
    expect(sessionStore.get()?.refreshToken).toBe('r1');
  });

  it('GET requests made while nobody uses the page are marked as background', async () => {
    start();
    const api = mockApi({ 'GET /attendance/today': { ok: true } });
    markUserActivity(Date.now() - 5 * 60_000);
    await apiRequest('/attendance/today');
    markUserActivity();
    await apiRequest('/attendance/today');
    const headers = api.fetch.mock.calls.map(([, init]) => ((init as RequestInit).headers as Record<string, string>)[BACKGROUND_HEADER]);
    expect(headers).toEqual(['1', undefined]);
  });
});
