import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { fileKeeper } from './files';
import { runLive } from './liveOnly';
import { getOnline, subscribeOnline } from './network';
import { OfflineQueue, summarize, type SubmitResult } from './queue';
import { createSender } from './sender';
import { createQueueStore } from './store';
import type { QueueItem, QueuedRequest } from './types';

/** How often waiting items are retried while the app is open. */
export const FLUSH_EVERY_MS = 30_000;

let defaultQueue: OfflineQueue | null = null;
/** The app's one queue (created on first use so tests can inject their own). */
export function getDefaultQueue(): OfflineQueue {
  defaultQueue ??= new OfflineQueue({ store: createQueueStore(), send: createSender(api), files: fileKeeper });
  return defaultQueue;
}

interface QueueValue {
  /** This agent's waiting and failed items, oldest first. */
  items: QueueItem[];
  summary: ReturnType<typeof summarize>;
  online: boolean;
  /**
   * Save a form or photo and send it now if possible. "queued" means it is
   * on the phone and will go when the signal returns.
   */
  submit: <T = unknown>(label: string, request: QueuedRequest) => Promise<SubmitResult<T>>;
  /** Run a live step (OTP, call, payment); throws NeedsSignalError without signal. */
  live: <T>(step: () => Promise<T>) => Promise<T>;
  flush: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const QueueContext = createContext<QueueValue | null>(null);

export function OfflineQueueProvider({ children, queue: injected }: { children: ReactNode; queue?: OfflineQueue }) {
  const queue = useMemo(() => injected ?? getDefaultQueue(), [injected]);
  const { session } = useAuth();
  const staffId = session?.staff.id ?? null;
  const [all, setAll] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = queue.subscribe(setAll);
    void queue.init().then(() => setAll(queue.list()));
    return unsubscribe;
  }, [queue]);

  const flush = useCallback(async () => {
    if (staffId) await queue.flush(staffId);
  }, [queue, staffId]);

  // Send when: signed in, signal returns, app comes to the front, every 30 s.
  useEffect(() => {
    if (!staffId) return;
    void flush();
    void getOnline().then(setOnline);
    const stopNetwork = subscribeOnline((isOnline) => {
      setOnline(isOnline);
      if (isOnline) void queue.flush(staffId, { force: true });
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });
    const timer = setInterval(() => void flush(), FLUSH_EVERY_MS);
    return () => {
      stopNetwork();
      appState.remove();
      clearInterval(timer);
    };
  }, [staffId, flush, queue]);

  const value = useMemo<QueueValue>(() => {
    const items = staffId ? all.filter((i) => i.staffId === staffId) : [];
    return {
      items,
      summary: summarize(all, staffId),
      online,
      submit: <T,>(label: string, request: QueuedRequest) => {
        if (!staffId) return Promise.reject(new Error('Sign in first'));
        return queue.submit<T>(staffId, label, request);
      },
      live: (step) => runLive(online, step),
      flush,
      retry: (id) => (staffId ? queue.retry(id, staffId) : Promise.resolve()),
      remove: (id) => queue.remove(id),
    };
  }, [all, staffId, online, queue, flush]);

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useOfflineQueue(): QueueValue {
  const value = useContext(QueueContext);
  if (!value) throw new Error('useOfflineQueue must be used inside <OfflineQueueProvider>');
  return value;
}
