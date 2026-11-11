import { isApiError } from '@/api/errors';
import { isLiveOnlyPath } from './liveOnly';
import type { QueueItem, QueuedRequest, QueueStore } from './types';

export type SendFn = (item: QueueItem) => Promise<unknown>;

export interface FileKeeper {
  /** Copies a captured file somewhere the system will not clean up; returns the new uri. */
  persist(uri: string, itemId: string, index: number): Promise<string>;
  /** Deletes a file once its item is sent or removed. */
  discard(uri: string): Promise<void>;
}

const keepAsIs: FileKeeper = {
  persist: async (uri) => uri,
  discard: async () => undefined,
};

export const BASE_RETRY_MS = 5_000;
export const MAX_RETRY_MS = 5 * 60_000;

/** 5 s, 10 s, 20 s … up to 5 minutes between automatic tries. */
export function retryDelay(attempts: number): number {
  return Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.max(0, attempts - 1));
}

export type SubmitResult<T = unknown> = { status: 'sent'; response: T } | { status: 'queued'; item: QueueItem };

type Listener = (items: QueueItem[]) => void;

let counter = 0;
function defaultId(): string {
  counter += 1;
  return `q-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The "waiting to send" queue (guide: forms and photos are saved on the
 * phone and sent automatically when the signal returns).
 *
 * - Items are sent oldest first, one at a time.
 * - No signal / server down (network error, 408, 429, 5xx): the item waits
 *   and is tried again later with a growing delay; flushing stops there.
 * - 401: the session ended; items wait for the next login of the same person.
 * - Any other 4xx: the server refused the data. The item is marked "failed"
 *   with the server's message and stays visible until the agent removes or
 *   retries it — nothing is dropped silently.
 */
export class OfflineQueue {
  private items: QueueItem[] = [];
  private listeners = new Set<Listener>();
  private flushing: Promise<void> | null = null;
  private loaded: Promise<void> | null = null;

  constructor(
    private readonly options: {
      store: QueueStore;
      send: SendFn;
      files?: FileKeeper;
      now?: () => number;
      makeId?: () => string;
    },
  ) {}

  private get now() {
    return this.options.now ?? Date.now;
  }

  private get files() {
    return this.options.files ?? keepAsIs;
  }

  /** Loads saved items. Anything left "sending" by a crash goes back to waiting. */
  init(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        const saved = await this.options.store.load();
        this.items = saved
          .map((item) => (item.state === 'sending' ? { ...item, state: 'waiting' as const } : item))
          .sort((a, b) => a.createdAt - b.createdAt);
        this.emit();
      })();
    }
    return this.loaded;
  }

  list(): QueueItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Saves a request on the phone. Throws for live-only steps (OTP, calls, payment). */
  async enqueue(staffId: string, label: string, request: QueuedRequest): Promise<QueueItem> {
    if (isLiveOnlyPath(request.path)) {
      throw new Error(`${request.path} needs the other person live and cannot be queued`);
    }
    if (request.json !== undefined && (request.fields || request.files)) {
      throw new Error('A queued request is either JSON or multipart, not both');
    }
    await this.init();
    const id = (this.options.makeId ?? defaultId)();
    const files = await Promise.all(
      (request.files ?? []).map(async (file, index) => ({ ...file, uri: await this.files.persist(file.uri, id, index) })),
    );
    const now = this.now();
    const item: QueueItem = {
      id,
      staffId,
      label,
      request: { ...request, ...(request.files ? { files } : {}) },
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
      state: 'waiting',
      lastError: null,
    };
    this.items.push(item);
    await this.options.store.save(item);
    this.emit();
    return { ...item };
  }

  /**
   * Saves the request and tries to send it at once. Resolves "sent" with the
   * server's answer, or "queued" when there is no signal. A refusal by the
   * server (4xx) is thrown and the item removed, because the agent is
   * looking at the form and can fix it.
   */
  async submit<T = unknown>(staffId: string, label: string, request: QueuedRequest): Promise<SubmitResult<T>> {
    const item = await this.enqueue(staffId, label, request);
    // Wait for any flush in progress so items stay in order.
    if (this.flushing) await this.flushing.catch(() => undefined);
    const position = this.items.findIndex((i) => i.id === item.id);
    const earlier = this.items.slice(0, position).some((i) => i.staffId === staffId && i.state === 'waiting');
    if (earlier) {
      void this.flush(staffId);
      return { status: 'queued', item };
    }
    const outcome = await this.sendOne(item.id);
    if (outcome.kind === 'sent') return { status: 'sent', response: outcome.response as T };
    if (outcome.kind === 'refused') {
      await this.remove(item.id);
      throw outcome.error;
    }
    return { status: 'queued', item: this.find(item.id) ?? item };
  }

  /** Sends every due item for this person. Safe to call often; runs one flush at a time. */
  flush(staffId: string, options: { force?: boolean } = {}): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      await this.init();
      try {
        for (;;) {
          const now = this.now();
          const next = this.items.find(
            (item) => item.staffId === staffId && item.state === 'waiting' && (options.force || item.nextAttemptAt <= now),
          );
          if (!next) return;
          const outcome = await this.sendOne(next.id);
          if (outcome.kind === 'retry' || outcome.kind === 'unauthorized') return;
        }
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  /** Agent taps "Send now" on a failed or waiting item. */
  async retry(id: string, staffId: string): Promise<void> {
    const item = this.find(id);
    if (!item) return;
    await this.update(id, { state: 'waiting', nextAttemptAt: this.now(), lastError: null });
    await this.flush(staffId, { force: true });
  }

  async remove(id: string): Promise<void> {
    const item = this.find(id);
    if (!item) return;
    this.items = this.items.filter((i) => i.id !== id);
    await this.options.store.remove(id);
    await Promise.all((item.request.files ?? []).map((file) => this.files.discard(file.uri).catch(() => undefined)));
    this.emit();
  }

  private find(id: string): QueueItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  private async update(id: string, patch: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const index = this.items.findIndex((i) => i.id === id);
    if (index < 0) return undefined;
    const next = { ...this.items[index], ...patch };
    this.items[index] = next;
    await this.options.store.save(next);
    this.emit();
    return next;
  }

  private async sendOne(
    id: string,
  ): Promise<
    | { kind: 'sent'; response: unknown }
    | { kind: 'retry' }
    | { kind: 'unauthorized' }
    | { kind: 'refused'; error: unknown }
    | { kind: 'missing' }
  > {
    const item = this.find(id);
    if (!item) return { kind: 'missing' };
    await this.update(id, { state: 'sending' });
    try {
      const response = await this.options.send(item);
      this.items = this.items.filter((i) => i.id !== id);
      await this.options.store.remove(id);
      await Promise.all((item.request.files ?? []).map((file) => this.files.discard(file.uri).catch(() => undefined)));
      this.emit();
      return { kind: 'sent', response };
    } catch (error) {
      const attempts = item.attempts + 1;
      if (!isApiError(error) || error.isRetryable) {
        await this.update(id, { state: 'waiting', attempts, nextAttemptAt: this.now() + retryDelay(attempts), lastError: null });
        return { kind: 'retry' };
      }
      if (error.status === 401) {
        await this.update(id, { state: 'waiting', attempts, nextAttemptAt: this.now() });
        return { kind: 'unauthorized' };
      }
      await this.update(id, { state: 'failed', attempts, lastError: error.message });
      return { kind: 'refused', error };
    }
  }

  private emit() {
    const snapshot = this.list();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** Counts for the Home "Saved on phone" row. */
export function summarize(items: QueueItem[], staffId: string | null) {
  const mine = staffId ? items.filter((i) => i.staffId === staffId) : [];
  return {
    total: mine.length,
    photos: mine.reduce((sum, i) => sum + (i.request.files?.length ?? 0), 0),
    forms: mine.filter((i) => !i.request.files?.length).length,
    failed: mine.filter((i) => i.state === 'failed').length,
    sending: mine.some((i) => i.state === 'sending'),
  };
}
