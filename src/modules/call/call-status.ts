/** Closed list for CallRecord.providerStatus. A webhook may only move forward. */

export const CALL_STATUSES = [
  'initiated',
  'ringing',
  'answered',
  'completed',
  'no_answer',
  'busy',
  'failed',
  'canceled',
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

export const FINAL_CALL_STATUSES = [
  'completed',
  'no_answer',
  'busy',
  'failed',
  'canceled',
] as const;

const RANK: Record<CallStatus, number> = {
  initiated: 1,
  ringing: 2,
  answered: 3,
  completed: 4,
  no_answer: 4,
  busy: 4,
  failed: 4,
  canceled: 4,
};

const ALIASES: Record<string, CallStatus> = {
  initiated: 'initiated',
  queued: 'initiated',
  ringing: 'ringing',
  in_progress: 'answered',
  answered: 'answered',
  completed: 'completed',
  no_answer: 'no_answer',
  busy: 'busy',
  failed: 'failed',
  canceled: 'canceled',
  cancelled: 'canceled',
};

export function normalizeCallStatus(raw: string): CallStatus | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIASES[key] ?? null;
}

export function canAdvanceCallStatus(current: string, next: string): boolean {
  const currentRank = RANK[current as CallStatus];
  const nextRank = RANK[next as CallStatus];
  if (currentRank === undefined || nextRank === undefined) {
    return false;
  }
  return nextRank > currentRank;
}
