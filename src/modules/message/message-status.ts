const FORWARD = ['queued', 'sent', 'delivered', 'read'] as const;

export type MessageStatus = (typeof FORWARD)[number] | 'failed';

/** A delivery webhook may move a message forward, or fail it before it is delivered. Never backwards. */
export function canAdvanceMessageStatus(current: string, next: string): boolean {
  if (current === next) {
    return false;
  }
  if (next === 'failed') {
    return current === 'queued' || current === 'sent';
  }
  if (current === 'failed') {
    return false;
  }
  const from = FORWARD.indexOf(current as (typeof FORWARD)[number]);
  const to = FORWARD.indexOf(next as (typeof FORWARD)[number]);
  if (from < 0 || to < 0) {
    return false;
  }
  return to > from;
}
