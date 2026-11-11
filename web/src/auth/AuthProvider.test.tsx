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

  it('signs out after 60 minutes without activity instead of refreshing', async () => {
    const api = mockApi({ 'POST /auth/refresh': () => ({ accessToken: fakeJwt({ role: 'ceo' }, 15 * 60), sessionId: 's' }) });
    startSession(15 * 60);
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    // Four refreshes happen without any activity inside the first hour…
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(14 * 60 * 1000 + 1000);
      });
    }
    expect(screen.getByText('out:idle')).toBeInTheDocument();
    expect(api.calls('POST /auth/refresh').length).toBeLessThan(5);
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
