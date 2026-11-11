import { useEffect, useRef } from 'react';
import { sessionStore } from '../../auth/session';

/**
 * The live channel from the server (GET /live/events, Server-Sent Events).
 * One connection per signed-in browser tab, shared by every screen.
 *
 * - Uses fetch streaming (not EventSource) so the staff token goes in the
 *   Authorization header, never in a URL.
 * - The server ends the stream when the token expires; the channel reconnects
 *   when the session store hands out a refreshed token. A network drop
 *   reconnects with a growing pause (1 s → 30 s).
 * - A 401/403 stops it until the next token: it never ends the session itself
 *   (the API client does that).
 *
 * Event types: `incoming_call`, `call_status`, `registration_step` (see
 * src/common/live/live-events.service.ts). Screens subscribe with useLiveEvent.
 */
export interface LiveEvent<T = Record<string, unknown>> {
  type: string;
  id?: string;
  data: T;
}

type Listener = (event: LiveEvent) => void;

export function parseSseChunk(buffer: string): { events: LiveEvent[]; rest: string } {
  const events: LiveEvent[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let type = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') type = value;
      else if (field === 'id') id = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length === 0) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(data.join('\n')) as Record<string, unknown>;
    } catch {
      parsed = { text: data.join('\n') };
    }
    events.push({ type, id, data: parsed });
  }
  return { events, rest };
}

class LiveChannel {
  private listeners = new Set<Listener>();
  private abort: AbortController | null = null;
  private token: string | null = null;
  private retryMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeSession: (() => void) | null = null;
  private blockedToken: string | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private start() {
    this.unsubscribeSession = sessionStore.subscribe(() => this.onSession());
    this.onSession();
  }

  private stop() {
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.disconnect();
    this.token = null;
  }

  private onSession() {
    const token = sessionStore.token();
    if (token === this.token && this.abort) return;
    this.disconnect();
    this.token = token;
    this.retryMs = 1000;
    if (token && token !== this.blockedToken) void this.connect(token);
  }

  private disconnect() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.abort?.abort();
    this.abort = null;
  }

  private emit(event: LiveEvent) {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // One screen's handler never breaks another's.
      }
    }
  }

  private scheduleRetry(token: string) {
    if (this.listeners.size === 0 || token !== this.token) return;
    this.retryTimer = setTimeout(() => void this.connect(token), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
  }

  private async connect(token: string) {
    const abort = new AbortController();
    this.abort = abort;
    try {
      const response = await fetch('/live/events', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: abort.signal,
        credentials: 'same-origin',
      });
      if (response.status >= 400 && ![408, 429, 502, 503, 504].includes(response.status)) {
        // Not allowed (401/403) or not there: wait for the next token instead of retrying.
        this.blockedToken = token;
        return;
      }
      if (!response.ok || !response.body) throw new Error(`live channel ${response.status}`);
      this.retryMs = 1000;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseChunk(buffer);
        buffer = rest;
        for (const event of events) if (event.type !== 'ping') this.emit(event);
      }
      // The server closed the stream (token expiry): wait for the refreshed token,
      // but retry anyway in case the same token is still good.
      if (this.abort === abort) this.scheduleRetry(token);
    } catch (err) {
      if (abort.signal.aborted) return;
      void err;
      this.scheduleRetry(token);
    }
  }
}

export const liveChannel = new LiveChannel();

/** Calls `handler` for every live event of `type` while the component is mounted. */
export function useLiveEvent<T = Record<string, unknown>>(type: string, handler: (data: T, event: LiveEvent<T>) => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(
    () =>
      liveChannel.subscribe((event) => {
        if (event.type === type) ref.current(event.data as T, event as LiveEvent<T>);
      }),
    [type],
  );
}
