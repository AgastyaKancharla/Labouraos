import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../App';
import { fakeJwt, mockApi, TEST_STAFF } from '../test/utils';
import { useAuth } from './AuthProvider';
import { sessionStore } from './session';

function Probe() {
  const { session, signOutReason } = useAuth();
  return <p>{session ? `in:${session.staff.code}` : `out:${signOutReason ?? '-'}`}</p>;
}

function startSession(expiresInSeconds: number) {
  const token = fakeJwt({ role: 'ceo' }, expiresInSeconds);
  sessionStore.set({ token, staff: TEST_STAFF.ceo, expiresAt: Date.now() + expiresInSeconds * 1000, totpSetupOnly: false });
}

describe('session keep-alive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    sessionStore.clear('logout');
  });

  it('refreshes the 15-minute token a minute before expiry while the person is active', async () => {
    const api = mockApi({ 'POST /auth/refresh': () => ({ accessToken: fakeJwt({ role: 'ceo' }, 15 * 60), sessionId: 's' }) });
    startSession(15 * 60);
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    expect(screen.getByText('in:CEO-0001')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
      window.dispatchEvent(new Event('keydown'));
      vi.advanceTimersByTime(4 * 60 * 1000 + 1000);
    });
    expect(api.calls('POST /auth/refresh')).toHaveLength(1);
    expect(screen.getByText('in:CEO-0001')).toBeInTheDocument();
  });

  it('an open console is not signed out by the tab\'s own idle clock; while the token works it renews with the bearer refresh, not the single-use token (21 Nov)', async () => {
    const api = mockApi({
      'POST /auth/refresh': () => ({ accessToken: fakeJwt({ role: 'ceo' }, 15 * 60), sessionId: 's1' }),
      'POST /auth/session/refresh': () => ({ accessToken: fakeJwt({ role: 'ceo' }, 15 * 60), refreshToken: 'rX', sessionId: 's1' }),
    });
    const token = fakeJwt({ role: 'ceo' }, 15 * 60);
    sessionStore.set({ token, staff: TEST_STAFF.ceo, expiresAt: Date.now() + 15 * 60 * 1000, totpSetupOnly: false, refreshToken: 'r0', sessionId: 's1' });
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    // Five renewals in 70 minutes without any activity: still signed in.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(14 * 60 * 1000 + 1000);
      });
    }
    expect(screen.getByText('in:CEO-0001')).toBeInTheDocument();
    expect(api.calls('POST /auth/refresh').length).toBeGreaterThanOrEqual(3);
    expect(api.calls('POST /auth/session/refresh')).toHaveLength(0);
    expect(sessionStore.get()?.refreshToken).toBe('r0');
  });

  it('a kept session whose token ran out (laptop asleep) renews with the refresh token', async () => {
    const api = mockApi({ 'POST /auth/session/refresh': () => ({ accessToken: fakeJwt({ role: 'ceo' }, 15 * 60), refreshToken: 'r1', sessionId: 's1' }) });
    sessionStore.set({ token: fakeJwt({ role: 'ceo' }, -60), staff: TEST_STAFF.ceo, expiresAt: Date.now() - 60_000, totpSetupOnly: false, refreshToken: 'r0', sessionId: 's1' });
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(api.calls('POST /auth/session/refresh')).toHaveLength(1);
    expect(sessionStore.get()?.refreshToken).toBe('r1');
  });

  it('a 401 is renewed and the request repeated once before signing out; a refused renewal signs out with the server\'s reason', async () => {
    const token = fakeJwt({ role: 'ceo' }, 15 * 60);
    sessionStore.set({ token, staff: TEST_STAFF.ceo, expiresAt: Date.now() + 15 * 60 * 1000, totpSetupOnly: false, refreshToken: 'r0', sessionId: 's1' });
    const fresh = fakeJwt({ role: 'ceo', code: 'fresh' }, 15 * 60);
    const api = mockApi({
      'GET /attendance/today': ({ init }: { init: RequestInit }) =>
        (init.headers as Record<string, string>).Authorization === `Bearer ${fresh}` ? { ok: true } : { status: 401, body: { statusCode: 401, message: 'Invalid or expired token' } },
      'POST /auth/session/refresh': () => ({ accessToken: fresh, refreshToken: 'r1', sessionId: 's1' }),
    });
    const { apiRequest } = await import('../lib/api/client');
    await expect(apiRequest('/attendance/today')).resolves.toEqual({ ok: true });
    expect(api.calls('POST /auth/session/refresh')).toHaveLength(1);
    expect(sessionStore.get()?.refreshToken).toBe('r1');

    mockApi({
      'GET /attendance/today': { status: 401, body: { statusCode: 401, message: 'Invalid or expired token' } },
      'POST /auth/session/refresh': { status: 401, body: { statusCode: 401, message: 'Session ended after being idle', details: { reason: 'idle' } } },
    });
    const reasons: (string | undefined)[] = [];
    const stop = sessionStore.subscribe((_s, reason) => reasons.push(reason));
    // A refused renewal first waits up to 2 s for another tab's token.
    const refused = expect(apiRequest('/attendance/today')).rejects.toMatchObject({ status: 401 });
    await vi.advanceTimersByTimeAsync(2500);
    await refused;
    stop();
    expect(sessionStore.get()).toBeNull();
    expect(reasons).toEqual(['idle']);
  });

  it('ends the session with the API reason when the refresh is refused (2-hour limit)', async () => {
    mockApi({ 'POST /auth/refresh': { status: 401, body: { statusCode: 401, message: 'Session has reached its maximum length' } } });
    startSession(15 * 60);
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(14 * 60 * 1000 + 1000);
    });
    expect(screen.getByText('out:max_length')).toBeInTheDocument();
  });
});
