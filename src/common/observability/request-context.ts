import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestStore {
  requestId: string;
  userId?: string;
  userRole?: string;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

/**
 * Returns the current request ID from the active async local storage context,
 * or undefined if called outside an active request/context scope.
 */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

/**
 * Runs a function within an explicit request context scope.
 * Useful for background jobs (BullMQ workers), webhook retries, or testing.
 */
export function runWithRequestId<T>(
  requestId: string,
  fn: () => T,
  extra?: Partial<RequestStore>,
): T {
  return requestContext.run({ requestId, ...extra }, fn);
}
