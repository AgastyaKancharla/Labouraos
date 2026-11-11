/**
 * When each repeating background job runs.
 *
 * Laboura works on India time, so every once-a-day job is a cron pattern read
 * in Asia/Kolkata (BullMQ passes `tz` to its cron parser). Without `tz` a
 * pattern is read in UTC, and '0 0 * * *' fires at 05:30 IST instead of
 * midnight. Plain `every: 86_400_000` is not used for daily jobs: it fires
 * 24 hours after whenever the worker first started, so the time of day drifts
 * with each fresh deploy.
 *
 * The two short-interval jobs (every minute, every 15 minutes) are the same in
 * any time zone, so they keep a fixed interval.
 *
 * Times are staggered so the nightly jobs do not all hit the database at once.
 */
export const JOB_TIME_ZONE = 'Asia/Kolkata';

export const DAILY_JOB_PATTERNS = {
  /** Midnight: the calling day that just ended is complete. */
  noPickupEvaluation: '0 0 * * *',
  /** Midnight: closes any working day an agent forgot to log out of. */
  forgottenLogout: '0 0 * * *',
  placementCompletion: '15 0 * * *',
  claimOverdue: '30 0 * * *',
  joiningReward: '45 0 * * *',
  patternFlags: '0 1 * * *',
  /** Quiet hours: deletes and anonymises records past their keeping period. */
  retentionCleanup: '0 2 * * *',
  /** Before the working day, so agents see today's follow-up tasks at login. */
  followUp: '0 6 * * *',
} as const;

export type DailyJobName = keyof typeof DAILY_JOB_PATTERNS;

export interface IndiaCronRepeat {
  pattern: string;
  tz: typeof JOB_TIME_ZONE;
}

/** The BullMQ repeat options for a once-a-day job, read in India time. */
export function dailyInIndia(job: DailyJobName): IndiaCronRepeat {
  return { pattern: DAILY_JOB_PATTERNS[job], tz: JOB_TIME_ZONE };
}

/** The same, for an explicit pattern (used by callers that override the time). */
export function cronInIndia(pattern: string): IndiaCronRepeat {
  return { pattern, tz: JOB_TIME_ZONE };
}

export const INTERVAL_JOB_MS = {
  interviewReply: 60_000,
  kycRecovery: 15 * 60 * 1000,
} as const;
