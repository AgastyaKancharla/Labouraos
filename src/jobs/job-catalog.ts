/**
 * Every repeating background job, as plain data: its BullMQ queue (the one
 * shared queue, see job-queue.ts), the BullMQ job name the shared worker
 * dispatches on, the id of its job scheduler in Redis, the name its JobRun rows
 * use, and a label for people.
 *
 * Plain strings on purpose: /health/ready reads this to check that every
 * schedule is still in Redis, and must not import the job classes (and the
 * services behind them). `job-catalog.spec.ts` fails when an entry here stops
 * matching its job file, or when a job with a scheduler is missing here.
 *
 * Why it matters: a free Render Key Value keeps nothing on disk. When it
 * restarts, every schedule is gone and no job fires again until something puts
 * them back (JobScheduleKeeper does, on every start and every 10 minutes).
 */
export interface JobCatalogEntry {
  /** Stable key, used in `POST /jobs/:job/run-now`. */
  key: string;
  /** Always LABOURA_JOBS_QUEUE now: every job shares one queue and one worker. */
  queue: string;
  /** The BullMQ job name; the shared worker runs the handler registered under it. Unique. */
  jobName: string;
  schedulerId: string;
  /** The JobRun.jobName each run writes. */
  runName: string;
  label: string;
  /** The queue this job had to itself before the shared queue (its old schedule is removed from there). */
  legacyQueue?: string;
}

/** The one queue every job uses (same value as LABOURA_JOBS_QUEUE in job-queue.ts, kept here as plain data). */
export const SHARED_JOB_QUEUE = 'laboura-jobs';

export const JOB_CATALOG: readonly JobCatalogEntry[] = [
  { key: 'noPickupEvaluation', queue: SHARED_JOB_QUEUE, jobName: 'daily-no-pickup-evaluation', schedulerId: 'daily-no-pickup-evaluation-scheduler', runName: 'daily-no-pickup-evaluation', label: 'Hits for no pickup (calling day closed)', legacyQueue: 'no-pickup-evaluation' },
  { key: 'forgottenLogout', queue: SHARED_JOB_QUEUE, jobName: 'close-forgotten-days', schedulerId: 'nightly-forgotten-logout', runName: 'close-forgotten-days', label: 'Attendance: close forgotten days', legacyQueue: 'forgotten-logout' },
  { key: 'placementCompletion', queue: SHARED_JOB_QUEUE, jobName: 'daily-placement-completion', schedulerId: 'daily-placement-completion-scheduler', runName: 'daily-placement-completion', label: '60-day guarantee clocks', legacyQueue: 'placement-completion' },
  { key: 'claimOverdue', queue: SHARED_JOB_QUEUE, jobName: 'daily-claim-overdue', schedulerId: 'daily-claim-overdue-scheduler', runName: 'daily-claim-overdue', label: 'Replacement claims overdue', legacyQueue: 'claim-overdue' },
  { key: 'joiningReward', queue: SHARED_JOB_QUEUE, jobName: 'daily-joining-reward', schedulerId: 'daily-joining-reward-scheduler', runName: 'daily-joining-reward', label: 'Joining rewards due', legacyQueue: 'joining-reward' },
  { key: 'patternFlags', queue: SHARED_JOB_QUEUE, jobName: 'daily-pattern-flags', schedulerId: 'daily-pattern-flags-scheduler', runName: 'daily-pattern-flags', label: 'Pattern flags (bypass, rejections)', legacyQueue: 'pattern-flags' },
  { key: 'retentionCleanup', queue: SHARED_JOB_QUEUE, jobName: 'daily-retention-cleanup', schedulerId: 'daily-retention-cleanup-scheduler', runName: 'retention-cleanup', label: 'Keeping data clean-up', legacyQueue: 'retention-cleanup' },
  { key: 'followUp', queue: SHARED_JOB_QUEUE, jobName: 'daily-follow-up', schedulerId: 'daily-follow-up-scheduler', runName: 'daily-follow-up', label: 'Follow-up calls created', legacyQueue: 'follow-up' },
  { key: 'shortageTasks', queue: SHARED_JOB_QUEUE, jobName: 'daily-shortage-tasks', schedulerId: 'daily-shortage-tasks-scheduler', runName: 'daily-shortage-tasks', label: 'Shortage tasks (trade × area)', legacyQueue: 'shortage-tasks' },
  { key: 'winBack', queue: SHARED_JOB_QUEUE, jobName: 'daily-win-back', schedulerId: 'daily-win-back-scheduler', runName: 'daily-win-back', label: 'Win-back call list', legacyQueue: 'win-back' },
  { key: 'weeklyReport', queue: SHARED_JOB_QUEUE, jobName: 'monday-weekly-report', schedulerId: 'monday-weekly-report-scheduler', runName: 'monday-weekly-report', label: 'Weekly report (Monday 9 AM)', legacyQueue: 'weekly-report' },
  { key: 'interviewReply', queue: SHARED_JOB_QUEUE, jobName: 'process-due-interview-replies', schedulerId: 'interview-reply-deadline-scheduler', runName: 'process-due-interview-replies', label: 'Offer reply and payment deadlines', legacyQueue: 'interview-reply-deadlines' },
  { key: 'kycRecovery', queue: SHARED_JOB_QUEUE, jobName: 'probe-id-check-recovery', schedulerId: 'kyc-recovery-scheduler', runName: 'probe-id-check-recovery', label: 'ID check recovery', legacyQueue: 'kyc-recovery' },
  { key: 'signupTracker', queue: SHARED_JOB_QUEUE, jobName: 'sweep-signup-tracker', schedulerId: 'signup-tracker-scheduler', runName: 'sweep-signup-tracker', label: 'App sign-ups: reminders, call tasks, closing' },
  { key: 'notificationSweep', queue: SHARED_JOB_QUEUE, jobName: 'sweep-notifications', schedulerId: 'notification-sweep-scheduler', runName: 'sweep-notifications', label: 'Notification bells that change with the clock', legacyQueue: 'notification-sweep' },
];

/** BullMQ keeps each queue's schedulers in this sorted set (default `bull` prefix). */
export function schedulerSetKey(queue: string): string {
  return `bull:${queue}:repeat`;
}

/**
 * The code a manual run is audited under (AuditLog.entityCode). It was the
 * job's own queue name before the shared queue; kept so old and new audit rows
 * match. A job added later is audited under its key.
 */
export function jobAuditCode(entry: JobCatalogEntry): string {
  return entry.legacyQueue ?? entry.key;
}

export function findJob(key: string): JobCatalogEntry | undefined {
  return JOB_CATALOG.find((entry) => entry.key === key);
}
