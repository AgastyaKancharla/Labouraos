import { ApiError, networkError } from '@/api/errors';
import { isLiveOnlyPath, NeedsSignalError, runLive } from './liveOnly';
import { OfflineQueue, retryDelay, summarize, type FileKeeper } from './queue';
import { createMemoryQueueStore, type QueueItem, type QueuedRequest } from './types';

const visit: QueuedRequest = { method: 'POST', path: '/businesses/BZ-00012/visits', json: { outcome: 'interested' } };
const photo: QueuedRequest = {
  method: 'POST',
  path: '/businesses/BZ-00012/photo',
  fields: { takenAt: '2026-11-11T08:35:00Z' },
  files: [{ field: 'photo', name: 'shop.jpg', type: 'image/jpeg', uri: 'file:///cache/shop.jpg' }],
};
const refused = (message = 'outcome must be one of …') => new ApiError({ status: 400, messages: [message] });

function setup(send: (item: QueueItem) => Promise<unknown>, files?: FileKeeper) {
  let now = 1_000_000;
  let id = 0;
  const store = createMemoryQueueStore();
  const queue = new OfflineQueue({ store, send: jest.fn(send), files, now: () => now, makeId: () => `item-${(id += 1)}` });
  return { queue, store, advance: (ms: number) => (now += ms), sendMock: (queue as unknown as { options: { send: jest.Mock } }).options.send };
}

describe('offline queue ("waiting to send")', () => {
  it('sends at once when there is signal and keeps nothing on the phone', async () => {
    const { queue, store } = setup(async () => ({ id: 'VIS-1' }));
    await expect(queue.submit('fa1', 'Visit · Lakshmi Tiffins', visit)).resolves.toEqual({ status: 'sent', response: { id: 'VIS-1' } });
    expect(queue.list()).toEqual([]);
    expect(store.items.size).toBe(0);
  });

  it('keeps the form on the phone without signal and sends it when signal returns', async () => {
    let online = false;
    const { queue, store, sendMock } = setup(async () => {
      if (!online) throw networkError();
      return { ok: true };
    });
    const result = await queue.submit('fa1', 'Visit', visit);
    expect(result.status).toBe('queued');
    expect(store.items.size).toBe(1);
    expect(queue.list()[0]).toMatchObject({ state: 'waiting', attempts: 1 });

    online = true;
    await queue.flush('fa1', { force: true });
    expect(queue.list()).toEqual([]);
    expect(store.items.size).toBe(0);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('survives the app closing: a new queue on the same storage still has the item', async () => {
    const store = createMemoryQueueStore();
    const first = new OfflineQueue({ store, send: async () => Promise.reject(networkError()) });
    await first.submit('fa1', 'Visit', visit);
    const sent: QueueItem[] = [];
    const second = new OfflineQueue({ store, send: async (item) => void sent.push(item) });
    await second.init();
    expect(second.list()).toHaveLength(1);
    await second.flush('fa1', { force: true });
    expect(sent[0].request).toEqual(visit);
  });

  it('puts an item left "sending" by a crash back to waiting', async () => {
    const store = createMemoryQueueStore([
      { id: 'x', staffId: 'fa1', label: 'Visit', request: visit, createdAt: 1, attempts: 0, nextAttemptAt: 0, state: 'sending', lastError: null },
    ]);
    const queue = new OfflineQueue({ store, send: async () => undefined });
    await queue.init();
    expect(queue.list()[0].state).toBe('waiting');
  });

  it('sends oldest first and stops at the first network failure', async () => {
    const order: string[] = [];
    let failOn: string | null = 'item-2';
    const { queue } = setup(async (item) => {
      if (item.id === failOn) throw networkError();
      order.push(item.id);
    });
    for (const label of ['a', 'b', 'c']) await queue.enqueue('fa1', label, visit);
    await queue.flush('fa1');
    expect(order).toEqual(['item-1']);
    expect(queue.list().map((i) => i.id)).toEqual(['item-2', 'item-3']);
    failOn = null;
    await queue.flush('fa1', { force: true });
    expect(order).toEqual(['item-1', 'item-2', 'item-3']);
  });

  it('waits longer between automatic tries (5 s, 10 s, 20 s … max 5 min)', async () => {
    expect([1, 2, 3, 10].map(retryDelay)).toEqual([5_000, 10_000, 20_000, 300_000]);
    const { queue, advance, sendMock } = setup(async () => Promise.reject(networkError()));
    await queue.enqueue('fa1', 'Visit', visit);
    await queue.flush('fa1');
    await queue.flush('fa1'); // not due yet
    expect(sendMock).toHaveBeenCalledTimes(1);
    advance(5_000);
    await queue.flush('fa1');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('marks a refused item "failed" with the server message and keeps it visible', async () => {
    const { queue } = setup(async () => Promise.reject(refused()));
    await queue.enqueue('fa1', 'Visit', visit);
    await queue.flush('fa1');
    expect(queue.list()[0]).toMatchObject({ state: 'failed', lastError: 'outcome must be one of …' });
    await queue.flush('fa1', { force: true });
    expect(queue.list()[0].attempts).toBe(1); // failed items are not retried automatically
  });

  it('throws a refusal straight back to the form when sending at once', async () => {
    const { queue, store } = setup(async () => Promise.reject(refused('Salary is required')));
    await expect(queue.submit('fa1', 'Vacancy', visit)).rejects.toMatchObject({ message: 'Salary is required' });
    expect(store.items.size).toBe(0);
  });

  it('pauses on 401 (session over) and keeps the item for the next login', async () => {
    const { queue } = setup(async () => Promise.reject(new ApiError({ status: 401, messages: ['Session ended after being idle'] })));
    await queue.enqueue('fa1', 'a', visit);
    await queue.enqueue('fa1', 'b', visit);
    await queue.flush('fa1');
    expect(queue.list().map((i) => i.state)).toEqual(['waiting', 'waiting']);
  });

  it('sends only the signed-in agent\'s items', async () => {
    const sent: string[] = [];
    const { queue } = setup(async (item) => void sent.push(item.staffId));
    await queue.enqueue('fa1', 'mine', visit);
    await queue.enqueue('fa2', 'theirs', visit);
    await queue.flush('fa1');
    expect(sent).toEqual(['fa1']);
    expect(summarize(queue.list(), 'fa2').total).toBe(1);
  });

  it('keeps photos safe until sent, then deletes them', async () => {
    const files: FileKeeper = {
      persist: jest.fn(async (uri: string, itemId: string) => `file:///documents/queue/${itemId}-${uri.split('/').pop()}`),
      discard: jest.fn(async () => undefined),
    };
    let online = false;
    const { queue } = setup(async () => {
      if (!online) throw networkError();
    }, files);
    await queue.submit('fa1', 'Shop photo', photo);
    expect(queue.list()[0].request.files?.[0].uri).toBe('file:///documents/queue/item-1-shop.jpg');
    expect(summarize(queue.list(), 'fa1')).toMatchObject({ total: 1, photos: 1, forms: 0, failed: 0 });
    online = true;
    await queue.flush('fa1', { force: true });
    expect(files.discard).toHaveBeenCalledWith('file:///documents/queue/item-1-shop.jpg');
  });

  it('lets the agent retry or remove an item', async () => {
    let ok = false;
    const { queue } = setup(async () => {
      if (!ok) throw refused();
    });
    await queue.enqueue('fa1', 'a', visit);
    await queue.flush('fa1');
    ok = true;
    await queue.retry('item-1', 'fa1');
    expect(queue.list()).toEqual([]);
    ok = false;
    await queue.enqueue('fa1', 'b', visit);
    await queue.remove('item-2');
    expect(queue.list()).toEqual([]);
  });

  it('notifies listeners when items change', async () => {
    const { queue } = setup(async () => Promise.reject(networkError()));
    const counts: number[] = [];
    queue.subscribe((items) => counts.push(items.length));
    await queue.enqueue('fa1', 'a', visit);
    expect(counts).toContain(1);
  });
});

describe('steps that need the other person live', () => {
  it('are never queued: OTPs, calls, payment, login', async () => {
    for (const path of [
      '/otp/send',
      '/auth/login',
      '/businesses/BZ-1/visit-assignments/a/owner-otp',
      '/telephony/calls',
      '/calls',
      '/payments/links',
      '/payouts/links',
      '/vacancies/VC-1/verify',
    ]) {
      expect(isLiveOnlyPath(path)).toBe(true);
    }
    expect(isLiveOnlyPath('/businesses/BZ-1/visits')).toBe(false);
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async () => undefined });
    await expect(queue.enqueue('fa1', 'OTP', { method: 'POST', path: '/otp/send', json: {} })).rejects.toThrow(/cannot be queued/);
  });

  it('need signal: refused offline, and a network failure becomes "needs signal"', async () => {
    const step = jest.fn(async () => 'ok');
    await expect(runLive(false, step)).rejects.toBeInstanceOf(NeedsSignalError);
    expect(step).not.toHaveBeenCalled();
    await expect(runLive(true, step)).resolves.toBe('ok');
    await expect(runLive(true, async () => Promise.reject(networkError()))).rejects.toBeInstanceOf(NeedsSignalError);
    await expect(runLive(true, async () => Promise.reject(refused('Wrong OTP')))).rejects.toMatchObject({ message: 'Wrong OTP' });
  });

  it('refuses a request that is both JSON and multipart', async () => {
    const queue = new OfflineQueue({ store: createMemoryQueueStore(), send: async () => undefined });
    await expect(queue.enqueue('fa1', 'x', { ...photo, json: {} })).rejects.toThrow(/either JSON or multipart/);
  });
});
