import { createMemoryStore } from '@/lib/storage';
import { SESSION_KEY, SESSION_MAX_IDLE_MS, SessionStore } from './session';

describe('customer session on the phone', () => {
  it('keeps only the tokens, and survives closing the app', async () => {
    const storage = createMemoryStore();
    await new SessionStore(storage).start('tok', 'refresh');
    expect(JSON.parse((await storage.getItem(SESSION_KEY)) ?? '{}')).toMatchObject({ accessToken: 'tok', refreshToken: 'refresh' });
    const reopened = new SessionStore(storage);
    await reopened.load();
    expect(reopened.token()).toBe('tok');
  });

  it('forgets a session unused for 90 days, and a corrupt one', async () => {
    const now = Date.now();
    const old = createMemoryStore({ [SESSION_KEY]: JSON.stringify({ accessToken: 'tok', lastUsedAt: now - SESSION_MAX_IDLE_MS - 1 }) });
    expect(await new SessionStore(old, () => now).load()).toBeNull();
    expect(await old.getItem(SESSION_KEY)).toBeNull();
    const corrupt = createMemoryStore({ [SESSION_KEY]: '{oops' });
    expect(await new SessionStore(corrupt).load()).toBeNull();
  });

  it('tells listeners why the session ended', async () => {
    const store = new SessionStore(createMemoryStore());
    const listener = jest.fn();
    store.subscribe(listener);
    await store.start('tok');
    await store.clear('expired');
    expect(listener).toHaveBeenLastCalledWith(null, 'expired');
  });
});
