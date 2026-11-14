import * as fs from 'fs';
import * as path from 'path';
import { JOB_CATALOG, schedulerSetKey } from './job-catalog';
import { CLAIM_OVERDUE_QUEUE, CLAIM_OVERDUE_SWEEP } from './claim-overdue.job';
import { FOLLOW_UP_QUEUE, FOLLOW_UP_SWEEP } from './follow-up.job';
import { FORGOTTEN_LOGOUT_QUEUE, FORGOTTEN_LOGOUT_SWEEP } from './forgotten-logout.job';
import { INTERVIEW_REPLY_QUEUE, INTERVIEW_REPLY_SWEEP } from './interview-reply.job';
import { JOINING_REWARD_QUEUE, JOINING_REWARD_SWEEP } from './joining-reward.job';
import { NO_PICKUP_EVALUATION_QUEUE, NO_PICKUP_EVALUATION_JOB } from './no-pickup-evaluation.job';
import { NOTIFICATION_SWEEP_QUEUE, NOTIFICATION_SWEEP } from './notification-sweep.job';
import { PATTERN_FLAGS_QUEUE, PATTERN_FLAGS_SWEEP } from './pattern-flags.job';
import { PLACEMENT_COMPLETION_QUEUE, PLACEMENT_COMPLETION_SWEEP } from './placement-completion.job';
import { RETENTION_CLEANUP_QUEUE } from './retention-cleanup.job';
import { SHORTAGE_TASKS_QUEUE, SHORTAGE_TASKS_SWEEP } from './shortage-tasks.job';
import { WEEKLY_REPORT_QUEUE, WEEKLY_REPORT_RUN } from './weekly-report.job';
import { WIN_BACK_QUEUE, WIN_BACK_SWEEP } from './win-back.job';
import { RETENTION_JOB_NAME } from '../modules/retention/retention.service';

describe('Job catalog: every repeating job, as plain data for the schedule keeper and /health/ready', () => {
  const byKey = Object.fromEntries(JOB_CATALOG.map((e) => [e.key, e]));

  it('matches each job file: queue name and JobRun name', () => {
    const expected: Record<string, [string, string]> = {
      claimOverdue: [CLAIM_OVERDUE_QUEUE, CLAIM_OVERDUE_SWEEP],
      followUp: [FOLLOW_UP_QUEUE, FOLLOW_UP_SWEEP],
      forgottenLogout: [FORGOTTEN_LOGOUT_QUEUE, FORGOTTEN_LOGOUT_SWEEP],
      interviewReply: [INTERVIEW_REPLY_QUEUE, INTERVIEW_REPLY_SWEEP],
      joiningReward: [JOINING_REWARD_QUEUE, JOINING_REWARD_SWEEP],
      noPickupEvaluation: [NO_PICKUP_EVALUATION_QUEUE, NO_PICKUP_EVALUATION_JOB],
      notificationSweep: [NOTIFICATION_SWEEP_QUEUE, NOTIFICATION_SWEEP],
      patternFlags: [PATTERN_FLAGS_QUEUE, PATTERN_FLAGS_SWEEP],
      placementCompletion: [PLACEMENT_COMPLETION_QUEUE, PLACEMENT_COMPLETION_SWEEP],
      // Retention records its own JobRun rows, under the retention service's name.
      retentionCleanup: [RETENTION_CLEANUP_QUEUE, RETENTION_JOB_NAME],
      shortageTasks: [SHORTAGE_TASKS_QUEUE, SHORTAGE_TASKS_SWEEP],
      weeklyReport: [WEEKLY_REPORT_QUEUE, WEEKLY_REPORT_RUN],
      winBack: [WIN_BACK_QUEUE, WIN_BACK_SWEEP],
    };
    expect(Object.keys(byKey).sort()).toEqual(Object.keys(expected).sort());
    for (const [key, [queue, runName]] of Object.entries(expected)) {
      expect({ key, queue: byKey[key].queue, runName: byKey[key].runName }).toEqual({ key, queue, runName });
    }
  });

  it('lists the scheduler id of every file that registers a BullMQ job scheduler', () => {
    const dir = __dirname;
    const ids = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .flatMap((src) => [...src.matchAll(/upsertJobScheduler\(\s*'([^']+)'/g)].map((m) => m[1]));
    expect(ids.length).toBeGreaterThanOrEqual(13);
    expect(ids.sort()).toEqual(JOB_CATALOG.map((e) => e.schedulerId).sort());
  });

  it('reads BullMQ\'s scheduler set under the default bull: prefix', () => {
    expect(schedulerSetKey('win-back')).toBe('bull:win-back:repeat');
  });
});
