import type { ApiClient } from '@/api/client';
import { appendFile } from './formFile';
import type { QueueItem } from './types';

/**
 * Turns a queued item into the real API call. The item id goes in the
 * Idempotency-Key header so a server that saw the first try can ignore a repeat.
 */
export function createSender(api: ApiClient) {
  return async (item: QueueItem): Promise<unknown> => {
    const { request } = item;
    const headers = { 'Idempotency-Key': item.id };
    if (request.fields || request.files) {
      const form = new FormData();
      for (const [key, value] of Object.entries(request.fields ?? {})) form.append(key, value);
      for (const file of request.files ?? []) await appendFile(form, file);
      return api.request(request.path, { method: request.method, form, headers, timeoutMs: 60_000 });
    }
    return api.request(request.path, { method: request.method, body: request.json ?? {}, headers });
  };
}
