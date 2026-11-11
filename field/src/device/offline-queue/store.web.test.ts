import 'fake-indexeddb/auto';
import { dataUrlToBlob } from './formFile.web';
import { createQueueStore } from './store.web';
import type { QueueItem } from './types';

const item = (id: string, uri?: string): QueueItem => ({
  id,
  staffId: 'fa1',
  label: id,
  request: uri
    ? { method: 'POST', path: '/p', files: [{ field: 'photo', name: 'a.jpg', type: 'image/jpeg', uri }] }
    : { method: 'POST', path: '/x', json: {} },
  createdAt: 1,
  attempts: 0,
  nextAttemptAt: 0,
  state: 'waiting',
  lastError: null,
});

describe('web app queue storage (IndexedDB)', () => {
  it('keeps items, photos included, across a reopened store', async () => {
    const photo = `data:image/jpeg;base64,${'A'.repeat(4000)}`;
    const store = createQueueStore();
    await store.save(item('a'));
    await store.save(item('b', photo));
    await store.remove('a');
    const reopened = createQueueStore();
    const items = await reopened.load();
    expect(items.map((i) => i.id)).toEqual(['b']);
    expect(items[0].request.files?.[0].uri).toBe(photo);
  });

  it('falls back to memory when IndexedDB is missing', async () => {
    const store = createQueueStore(null);
    await store.save(item('m'));
    expect((await store.load()).map((i) => i.id)).toEqual(['m']);
  });
});

describe('data URL photos', () => {
  it('become real JPEG files for the upload', async () => {
    const blob = dataUrlToBlob('data:image/jpeg;base64,/9j/4AAQ');
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe(6);
    expect(() => dataUrlToBlob('file:///x.jpg')).toThrow();
  });
});
