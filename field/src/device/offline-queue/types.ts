/** A photo or file attached to a queued form (multipart upload). */
export interface QueuedFile {
  /** Multipart field name the API expects, e.g. "photo". */
  field: string;
  name: string;
  type: string;
  /** file:// path (phone app) or data: URL (web app). */
  uri: string;
}

/**
 * A request saved on the phone until it can be sent. Either `json` or
 * `fields`/`files` (multipart), never both.
 */
export interface QueuedRequest {
  method: 'POST' | 'PUT' | 'PATCH';
  /** API path, e.g. "/businesses/BZ-00012/visits". */
  path: string;
  json?: unknown;
  fields?: Record<string, string>;
  files?: QueuedFile[];
}

export type QueueItemState = 'waiting' | 'sending' | 'failed';

export interface QueueItem {
  /** Random id; also sent as the Idempotency-Key header so a repeat is harmless. */
  id: string;
  /** Only this staff member's session sends it. */
  staffId: string;
  /** Short description for the "waiting to send" list, e.g. "Visit · Lakshmi Tiffins". */
  label: string;
  request: QueuedRequest;
  createdAt: number;
  attempts: number;
  /** Earliest time the next automatic try may happen (ms since epoch). */
  nextAttemptAt: number;
  state: QueueItemState;
  /** Why it failed (server message), for state "failed". */
  lastError: string | null;
}

/** Where queued items live on the phone. */
export interface QueueStore {
  load(): Promise<QueueItem[]>;
  save(item: QueueItem): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createMemoryQueueStore(initial: QueueItem[] = []): QueueStore & { items: Map<string, QueueItem> } {
  const items = new Map(initial.map((item) => [item.id, item]));
  return {
    items,
    async load() {
      return [...items.values()].map((item) => ({ ...item }));
    },
    async save(item) {
      items.set(item.id, { ...item });
    },
    async remove(id) {
      items.delete(id);
    },
  };
}
