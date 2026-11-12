export const JOB_SEEKER_STATUSES = [
  'lead',
  'consented',
  'pending_activation',
  'active',
  'paused',
  'deactivated',
  'placed',
  /** Found a job on his own: profile closed, no refund; he can pay again to come back. */
  'closed',
  /**
   * His ₹499 was refunded (guarantee ran out with no offer, or a CEO goodwill refund):
   * out of the matching pool. He can pay ₹499 again (reactivate), which resets the
   * hits and starts a new 30-day guarantee; the win-back list (N5) asks him to.
   */
  'refunded',
] as const;

/** Statuses a job seeker comes back from by paying ₹499 again (reactivation). */
export const REACTIVATABLE_STATUSES: readonly string[] = ['deactivated', 'closed', 'refunded'];

/** Statuses that leave the matching pool when his ₹499 is refunded. */
export const REFUND_LEAVES_POOL_FROM: readonly string[] = ['active', 'paused'];

export type JobSeekerStatus = (typeof JOB_SEEKER_STATUSES)[number];

export function isJobSeekerStatus(status: string): status is JobSeekerStatus {
  return (JOB_SEEKER_STATUSES as readonly string[]).includes(status);
}

/**
 * Maps legacy/historical status values if read from existing database rows:
 * e.g. 'pending_payment' -> 'pending_activation'
 * 'pending' -> 'pending_activation'
 * 'activated' -> 'active'
 */
export function normalizeJobSeekerStatus(rawStatus: string): JobSeekerStatus {
  const normalized = rawStatus.toLowerCase().trim();
  if (isJobSeekerStatus(normalized)) {
    return normalized;
  }
  if (normalized === 'pending_payment' || normalized === 'pending') {
    return 'pending_activation';
  }
  if (normalized === 'activated') {
    return 'active';
  }
  return 'lead';
}
