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
] as const;

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
