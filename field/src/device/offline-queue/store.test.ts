import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSender } from './sender';
import { createQueueStore, QUEUE_STORAGE_KEY } from './store';
import type { QueueItem } from './types';

const item = (id: string): QueueItem => ({
  id,
  staffId: 'fa1',
  label: id,
  request: { method: 'POST', path: '/x', json: { a: 1 } },
  createdAt: 1,
  attempts: 0,
  nextAttemptAt: 0,
  state: 'waiting',
  lastError: null,
});

describe('phone queue storage (AsyncStorage)', () => {
  beforeEach(() => AsyncStorage.clear());

  it('saves, updates and removes items, even when saves overlap', async () => {
    const store = createQueueStore();
    await Promise.all([store.save(item('a')), store.save(item('b')), store.save(item('c'))]);
    await store.save({ ...item('b'), attempts: 2 });
    await store.remove('a');
    const items = await store.load();
    expect(items.map((i) => i.id).sort()).toEqual(['b', 'c']);
    expect(items.find((i) => i.id === 'b')?.attempts).toBe(2);
    expect(await AsyncStorage.getItem(QUEUE_STORAGE_KEY)).toContain('"b"');
  });

  it('treats unreadable storage as empty', async () => {
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, '{not json');
    await expect(createQueueStore().load()).resolves.toEqual([]);
  });
});

describe('sender', () => {
  it('sends JSON with an Idempotency-Key', async () => {
    const request = jest.fn(async () => ({ ok: true }));
    await createSender({ request } as never)(item('q-1'));
    expect(request).toHaveBeenCalledWith('/x', { method: 'POST', body: { a: 1 }, headers: { 'Idempotency-Key': 'q-1' } });
  });

  it('sends photos as multipart with the stamp fields', async () => {
    const request = jest.fn(async (_path: string, _options: { form: FormData }) => ({}));
    await createSender({ request } as never)({
      ...item('q-2'),
      request: {
        method: 'POST',
        path: '/businesses/BZ-1/photo',
        fields: { takenAt: '2026-11-11T08:35:00Z' },
        files: [{ field: 'photo', name: 'shop.jpg', type: 'image/jpeg', uri: 'file:///d/shop.jpg' }],
      },
    });
    const options = request.mock.calls[0][1] as unknown as { form: FormData; headers: Record<string, string> };
    expect(options.headers['Idempotency-Key']).toBe('q-2');
    expect(options.form).toBeInstanceOf(FormData);
  });
});
