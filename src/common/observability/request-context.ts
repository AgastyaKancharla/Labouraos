import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestStore {
  requestId: string;
  userId?: string;
  userRole?: string;
  /** The address Express resolved for this request (trust proxy applied), for the audit log's network column. */
  ip?: string;
  /** Set once the token is checked (JwtStrategy) or the login names its device. */
  staffId?: string;
  sessionId?: string;
  deviceId?: string;
  /** Resolved once per request by AuditService and reused by every audit row the request writes. */
  auditDevice?: Promise<unknown>;
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

/**
 * Records who is calling from which device, so every audit row this request
 * writes carries the device and network (C-Audit's Device column). A no-op
 * outside a request.
 */
export function noteRequestDevice(details: { staffId?: string; sessionId?: string; deviceId?: string | null }): void {
  const store = requestContext.getStore();
  if (!store) {
    return;
  }
  if (details.staffId) store.staffId = details.staffId;
  if (details.sessionId) store.sessionId = details.sessionId;
  if (details.deviceId) store.deviceId = details.deviceId;
  store.auditDevice = undefined;
}
