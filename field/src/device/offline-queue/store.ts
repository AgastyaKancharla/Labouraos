import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueueItem, QueueStore } from './types';

export const QUEUE_STORAGE_KEY = 'laboura_field_queue';

/**
 * Phone app: the list of queued items in AsyncStorage (photos themselves are
 * files, see files.ts — only their paths are stored here).
 */
export function createQueueStore(storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem'> = AsyncStorage): QueueStore {
  let chain: Promise<unknown> = Promise.resolve();
  async function read(): Promise<QueueItem[]> {
    try {
      const raw = await storage.getItem(QUEUE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as QueueItem[]) : [];
    } catch {
      return [];
    }
  }
  // Writes are serialised so two quick saves never overwrite each other.
  function write(change: (items: QueueItem[]) => QueueItem[]): Promise<void> {
    const next = chain.then(async () => {
      const items = change(await read());
      await storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items));
    });
    chain = next.catch(() => undefined);
    return next;
  }
  return {
    load: read,
    save: (item) => write((items) => [...items.filter((i) => i.id !== item.id), item]),
    remove: (id) => write((items) => items.filter((i) => i.id !== id)),
  };
}
