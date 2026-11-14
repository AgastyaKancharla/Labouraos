import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { AlertService } from '../common/observability/alert.service';
import { redisClientOptions } from '../common/redis/worker-heartbeat';
import { processRole, runsJobs } from '../common/process/process-role';
import { recordJobRun } from './job-run-recorder';
import { JOB_CATALOG, JobCatalogEntry, findJob } from './job-catalog';
import { missingSchedules, ScheduleReader } from './job-schedule-check';
import { NoPickupEvaluationJob } from './no-pickup-evaluation.job';
import { ForgottenLogoutJob } from './forgotten-logout.job';
import { PlacementCompletionJob } from './placement-completion.job';
import { ClaimOverdueJob } from './claim-overdue.job';
import { JoiningRewardJob } from './joining-reward.job';
import { PatternFlagsJob } from './pattern-flags.job';
import { RetentionCleanupJob } from './retention-cleanup.job';
import { FollowUpJob } from './follow-up.job';
import { ShortageTasksJob } from './shortage-tasks.job';
import { WinBackJob } from './win-back.job';
import { WeeklyReportJob } from './weekly-report.job';
import { InterviewReplyJob } from './interview-reply.job';
import { NotificationSweepJob } from './notification-sweep.job';

/** How often the keeper checks that every schedule is still in Redis. */
export const DEFAULT_SCHEDULE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const SCHEDULE_TIMEOUT_MS = 5000;

interface JobHandle {
  /** Writes (or rewrites) the job's scheduler in Redis. Idempotent. */
  schedule: () => Promise<void>;
  /** Runs the job's work now, in this process, and returns its counts. */
  run: () => Promise<unknown>;
  /** True when the run already writes its own JobRun row. */
  recordsItself?: boolean;
}

export interface EnsureResult {
  registered: string[];
  failed: { key: string; error: string }[];
}

export interface ScheduleStatus {
  key: string;
  label: string;
  queue: string;
  present: boolean;
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Keeps every job schedule in Redis, and runs any job on demand.
 *
 * Each job writes its own schedule once when the process starts. That is not
 * enough on a free Render Key Value, which keeps nothing on disk: a Key Value
 * restart wipes every schedule while the process keeps running, and no job
 * would ever fire again. So, in every process that runs jobs
 * (PROCESS_ROLE=worker, or `all` on the free tier), the keeper:
 *   - re-registers every schedule once the app has started (and logs how many
 *     are in Redis — the start-up check);
 *   - checks every 10 minutes and re-registers whatever is missing;
 *   - re-registers everything whenever its Redis connection comes back
 *     ("ready" after a lost connection).
 * /health/ready reports `schedules` as failed while any is missing.
 *
 * `run(key)` is the CEO's "run now": it calls the job's own work directly in
 * this process, so it works even when no worker is reading the queue.
 */
@Injectable()
export class JobScheduleKeeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobScheduleKeeper.name);
  private readonly handles: Record<string, JobHandle>;
  private timer: NodeJS.Timeout | null = null;
  private client: Redis | null = null;
  private connectedOnce = false;

  constructor(
    noPickup: NoPickupEvaluationJob,
    forgottenLogout: ForgottenLogoutJob,
    placementCompletion: PlacementCompletionJob,
    claimOverdue: ClaimOverdueJob,
    joiningReward: JoiningRewardJob,
    patternFlags: PatternFlagsJob,
    retentionCleanup: RetentionCleanupJob,
    followUp: FollowUpJob,
    shortageTasks: ShortageTasksJob,
    winBack: WinBackJob,
    weeklyReport: WeeklyReportJob,
    interviewReply: InterviewReplyJob,
    notificationSweep: NotificationSweepJob,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly alerts?: AlertService,
  ) {
    this.handles = {
      noPickupEvaluation: { schedule: () => noPickup.scheduleDailyJob(), run: () => noPickup.evaluateNoPickups(), recordsItself: true },
      forgottenLogout: { schedule: () => forgottenLogout.schedule(), run: () => forgottenLogout.process() },
      placementCompletion: { schedule: () => placementCompletion.schedule(), run: () => placementCompletion.process() },
      claimOverdue: { schedule: () => claimOverdue.schedule(), run: () => claimOverdue.process() },
      joiningReward: { schedule: () => joiningReward.schedule(), run: () => joiningReward.process() },
      patternFlags: { schedule: () => patternFlags.schedule(), run: () => patternFlags.process() },
      retentionCleanup: { schedule: () => retentionCleanup.schedule(), run: () => retentionCleanup.process(), recordsItself: true },
      followUp: { schedule: () => followUp.schedule(), run: () => followUp.process() },
      shortageTasks: { schedule: () => shortageTasks.schedule(), run: () => shortageTasks.process() },
      winBack: { schedule: () => winBack.schedule(), run: () => winBack.process() },
      weeklyReport: { schedule: () => weeklyReport.schedule(), run: () => weeklyReport.process() },
      interviewReply: { schedule: () => interviewReply.schedule(), run: () => interviewReply.process() },
      notificationSweep: { schedule: () => notificationSweep.schedule(), run: () => notificationSweep.process() },
    };
  }

  /** Every job the keeper can schedule and run (same keys as JOB_CATALOG). */
  keys(): string[] {
    return Object.keys(this.handles);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!runsJobs()) return;
    const result = await this.ensureAll('start');
    const missing = await this.safeMissing();
    if (missing === null) {
      this.logger.warn('Start-up check: could not read the job schedules from Redis; will retry every 10 minutes');
    } else if (missing.length === 0) {
      this.logger.log(
        `Start-up check: all ${JOB_CATALOG.length} job schedules are in Redis (PROCESS_ROLE=${processRole()})`,
      );
    } else {
      this.logger.error(
        `Start-up check: ${missing.length} job schedule(s) missing after registering: ${missing.map((m) => m.key).join(', ')}` +
          (result.failed.length ? ` (errors: ${result.failed.map((f) => `${f.key}: ${f.error}`).join('; ')})` : ''),
      );
    }
    this.watchRedis();
    const intervalMs = Number(process.env.JOB_SCHEDULE_CHECK_INTERVAL_MS) || DEFAULT_SCHEDULE_CHECK_INTERVAL_MS;
    this.timer = setInterval(() => void this.checkAndRepair(), intervalMs);
    this.timer.unref?.();
  }

  /** Writes every schedule again. Safe to repeat: BullMQ upserts by scheduler id. */
  async ensureAll(reason: string): Promise<EnsureResult> {
    const result: EnsureResult = { registered: [], failed: [] };
    for (const [key, handle] of Object.entries(this.handles)) {
      try {
        await withTimeout(handle.schedule(), SCHEDULE_TIMEOUT_MS, `Scheduling ${key}`);
        result.registered.push(key);
      } catch (error: unknown) {
        result.failed.push({ key, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (result.failed.length) {
      this.logger.warn(
        `Re-registering job schedules (${reason}): ${result.failed.length} failed — ${result.failed.map((f) => `${f.key}: ${f.error}`).join('; ')}`,
      );
    }
    return result;
  }

  /**
   * The periodic self-check: reads which schedules are missing and, if any,
   * writes them all again and raises an alert. Returns the keys that were missing.
   */
  async checkAndRepair(reader?: ScheduleReader): Promise<string[]> {
    const missing = await this.safeMissing(reader);
    if (missing === null || missing.length === 0) return [];
    const keys = missing.map((m) => m.key);
    this.logger.warn(`Job schedules missing from Redis (${keys.join(', ')}); registering them again`);
    await this.ensureAll('self-check');
    await this.alerts
      ?.sendAlert({
        title: 'Job schedules were missing and have been put back',
        message:
          `${keys.length} job schedule(s) were missing from Redis (${keys.join(', ')}), usually because the Key Value restarted. ` +
          'They have been registered again. Use "Run now" on System Health for any job that should have run in the meantime.',
        severity: 'warning',
        metadata: { missing: keys },
      })
      .catch(() => undefined);
    return keys;
  }

  /** Which schedules are in Redis right now (CEO view). */
  async status(reader?: ScheduleReader): Promise<ScheduleStatus[]> {
    const missing = await missingSchedules(reader ?? this.getClient());
    const missingKeys = new Set(missing.map((m) => m.key));
    return JOB_CATALOG.map((entry) => ({
      key: entry.key,
      label: entry.label,
      queue: entry.queue,
      present: !missingKeys.has(entry.key),
    }));
  }

  /**
   * Runs one job now, in this process (not through the queue), and records a
   * JobRun row like a scheduled run. Throws when the key is unknown.
   */
  async run(key: string): Promise<{ job: JobCatalogEntry; result: unknown }> {
    const job = findJob(key);
    const handle = this.handles[key];
    if (!job || !handle) throw new Error(`Unknown job '${key}'`);
    const result = handle.recordsItself
      ? await handle.run()
      : await recordJobRun(this.prisma, job.runName, () => handle.run());
    return { job, result };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.client) {
      const client = this.client;
      this.client = null;
      client.disconnect();
    }
  }

  private async safeMissing(reader?: ScheduleReader): Promise<JobCatalogEntry[] | null> {
    try {
      return await withTimeout(missingSchedules(reader ?? this.getClient()), SCHEDULE_TIMEOUT_MS, 'Reading job schedules');
    } catch (error: unknown) {
      this.logger.warn(`Could not read job schedules: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /** After a lost Redis connection comes back, every schedule is written again. */
  private watchRedis(): void {
    const client = this.getClient();
    client.on('ready', () => {
      if (!this.connectedOnce) {
        this.connectedOnce = true;
        return;
      }
      this.logger.warn('Redis connection is back; registering every job schedule again');
      void this.ensureAll('redis reconnected');
    });
    if (client.status === 'ready') this.connectedOnce = true;
  }

  private getClient(): Redis {
    if (!this.client) {
      this.client = new Redis({ ...redisClientOptions(), maxRetriesPerRequest: 1 });
      // Errors surface through the checks; stop ioredis printing each retry.
      this.client.on('error', () => undefined);
    }
    return this.client;
  }
}
