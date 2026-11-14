/**
 * Every repeating background job, as plain data: its BullMQ queue, the id of
 * its job scheduler in Redis, the name its JobRun rows use, and a label for
 * people.
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
  queue: string;
  schedulerId: string;
  /** The JobRun.jobName each run writes. */
  runName: string;
  label: string;
}

export const JOB_CATALOG: readonly JobCatalogEntry[] = [
  { key: 'noPickupEvaluation', queue: 'no-pickup-evaluation', schedulerId: 'daily-no-pickup-evaluation-scheduler', runName: 'daily-no-pickup-evaluation', label: 'Hits for no pickup (calling day closed)' },
  { key: 'forgottenLogout', queue: 'forgotten-logout', schedulerId: 'nightly-forgotten-logout', runName: 'close-forgotten-days', label: 'Attendance: close forgotten days' },
  { key: 'placementCompletion', queue: 'placement-completion', schedulerId: 'daily-placement-completion-scheduler', runName: 'daily-placement-completion', label: '60-day guarantee clocks' },
  { key: 'claimOverdue', queue: 'claim-overdue', schedulerId: 'daily-claim-overdue-scheduler', runName: 'daily-claim-overdue', label: 'Replacement claims overdue' },
  { key: 'joiningReward', queue: 'joining-reward', schedulerId: 'daily-joining-reward-scheduler', runName: 'daily-joining-reward', label: 'Joining rewards due' },
  { key: 'patternFlags', queue: 'pattern-flags', schedulerId: 'daily-pattern-flags-scheduler', runName: 'daily-pattern-flags', label: 'Pattern flags (bypass, rejections)' },
  { key: 'retentionCleanup', queue: 'retention-cleanup', schedulerId: 'daily-retention-cleanup-scheduler', runName: 'retention-cleanup', label: 'Keeping data clean-up' },
  { key: 'followUp', queue: 'follow-up', schedulerId: 'daily-follow-up-scheduler', runName: 'daily-follow-up', label: 'Follow-up calls created' },
  { key: 'shortageTasks', queue: 'shortage-tasks', schedulerId: 'daily-shortage-tasks-scheduler', runName: 'daily-shortage-tasks', label: 'Shortage tasks (trade × area)' },
  { key: 'winBack', queue: 'win-back', schedulerId: 'daily-win-back-scheduler', runName: 'daily-win-back', label: 'Win-back call list' },
  { key: 'weeklyReport', queue: 'weekly-report', schedulerId: 'monday-weekly-report-scheduler', runName: 'monday-weekly-report', label: 'Weekly report (Monday 9 AM)' },
  { key: 'interviewReply', queue: 'interview-reply-deadlines', schedulerId: 'interview-reply-deadline-scheduler', runName: 'process-due-interview-replies', label: 'Offer reply and payment deadlines' },
  { key: 'notificationSweep', queue: 'notification-sweep', schedulerId: 'notification-sweep-scheduler', runName: 'sweep-notifications', label: 'Notification bells that change with the clock' },
];

/** BullMQ keeps each queue's schedulers in this sorted set (default `bull` prefix). */
export function schedulerSetKey(queue: string): string {
  return `bull:${queue}:repeat`;
}

export function findJob(key: string): JobCatalogEntry | undefined {
  return JOB_CATALOG.find((entry) => entry.key === key);
}
