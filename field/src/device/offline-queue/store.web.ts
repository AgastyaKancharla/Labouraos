import type { QueueItem, QueueStore } from './types';

export const QUEUE_DB_NAME = 'laboura-field';
export const QUEUE_DB_STORE = 'queue';

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(QUEUE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(QUEUE_DB_STORE)) {
        request.result.createObjectStore(QUEUE_DB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_DB_STORE, mode);
    const request = work(tx.objectStore(QUEUE_DB_STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Web app: IndexedDB, which holds photos (data URLs) far beyond
 * localStorage's 5 MB. Survives closing the tab or the home-screen app.
 */
export function createQueueStore(factory: IDBFactory | null = typeof indexedDB !== 'undefined' ? indexedDB : null): QueueStore {
  if (!factory) {
    // No IndexedDB (very old browser / blocked): keep items for this session only.
    const memory = new Map<string, QueueItem>();
    return {
      load: async () => [...memory.values()],
      save: async (item) => void memory.set(item.id, item),
      remove: async (id) => void memory.delete(id),
    };
  }
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () => (dbPromise ??= openDb(factory));
  return {
    load: async () => run<QueueItem[]>(await db(), 'readonly', (store) => store.getAll() as IDBRequest<QueueItem[]>),
    save: async (item) => {
      await run(await db(), 'readwrite', (store) => store.put(item));
    },
    remove: async (id) => {
      await run(await db(), 'readwrite', (store) => store.delete(id));
    },
  };
}
