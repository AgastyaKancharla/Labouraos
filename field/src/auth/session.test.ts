import { createMemoryStore } from '@/lib/storage';
import {
  decodeJwt,
  IDLE_LIMIT_MS,
  MAX_SESSION_MS,
  reasonFromMessage,
  SESSION_STORAGE_KEY,
  SessionStore,
  sessionLimitReached,
  type Session,
} from './session';

function token(expSeconds: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ sub: 's1', role: 'field_agent', exp: expSeconds })}.sig`;
}

const staff = { id: 's1', code: 'FA-00017', name: 'Kiran Kumar', role: 'field_agent' };
const T0 = Date.UTC(2026, 10, 11, 4, 0, 0);

describe('session limits', () => {
  const base: Session = { token: 't', sessionId: 'x', staff, tokenExpiresAt: T0 + 15 * 60_000, loginAt: T0, lastActivityAt: T0 };

  it('ends after 1 hour idle, 2 hours total, or an expired token', () => {
    expect(sessionLimitReached(base, T0 + 60_000)).toBeNull();
    expect(sessionLimitReached({ ...base, tokenExpiresAt: T0 + 3 * 3600_000 }, T0 + IDLE_LIMIT_MS + 1)).toBe('idle');
    expect(
      sessionLimitReached({ ...base, tokenExpiresAt: T0 + 3 * 3600_000, lastActivityAt: T0 + MAX_SESSION_MS }, T0 + MAX_SESSION_MS + 1),
    ).toBe('max_length');
    expect(sessionLimitReached(base, T0 + 15 * 60_000)).toBe('expired');
  });

  it('maps server 401 messages to a reason', () => {
    expect(reasonFromMessage('Session ended after being idle')).toBe('idle');
    expect(reasonFromMessage('Session has reached its maximum length')).toBe('max_length');
    expect(reasonFromMessage('Session has been revoked')).toBe('revoked');
    expect(reasonFromMessage('Invalid or expired token')).toBe('expired');
    expect(reasonFromMessage('Unauthorized')).toBe('unauthorized');
  });

  it('reads the token expiry without verifying it', () => {
    expect(decodeJwt(token(1234))?.exp).toBe(1234);
    expect(decodeJwt('garbage')).toBeNull();
  });
});

describe('SessionStore', () => {
  it('keeps the session on the phone so reopening the app stays signed in', async () => {
    let now = T0;
    const storage = createMemoryStore();
    const store = new SessionStore(storage, () => now);
    await store.start(token(T0 / 1000 + 900), staff, 'sess-1');
    now += 5 * 60_000;
    const reopened = new SessionStore(storage, () => now);
    const loaded = await reopened.load();
    expect(loaded?.staff.code).toBe('FA-00017');
    expect(reopened.token()).toContain('.');
  });

  it('drops a saved session whose limit has passed, and says why', async () => {
    const storage = createMemoryStore();
    const store = new SessionStore(storage, () => T0);
    await store.start(token(T0 / 1000 + 900), staff, null);
    const later = new SessionStore(storage, () => T0 + 16 * 60_000);
    const reasons: (string | undefined)[] = [];
    later.subscribe((_s, reason) => reasons.push(reason));
    expect(await later.load()).toBeNull();
    expect(reasons).toEqual(['expired']);
    expect(await storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('records activity and refreshes the token', async () => {
    let now = T0;
    const store = new SessionStore(createMemoryStore(), () => now);
    await store.start(token(T0 / 1000 + 900), staff, null);
    now += 10 * 60_000;
    store.touch();
    expect(store.get()?.lastActivityAt).toBe(now);
    await store.replaceToken(token(now / 1000 + 900));
    expect(store.get()?.tokenExpiresAt).toBe(now + 900_000);
    expect(store.get()?.loginAt).toBe(T0);
  });

  it('clears on logout and on a passed limit', async () => {
    let now = T0;
    const storage = createMemoryStore();
    const store = new SessionStore(storage, () => now);
    await store.start(token(T0 / 1000 + 900), staff, null);
    now += 16 * 60_000;
    expect(await store.enforceLimits()).toBe('expired');
    expect(store.get()).toBeNull();
    await store.start(token(now / 1000 + 900), staff, null);
    await store.clear('logout');
    expect(await storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});
