import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { INTERVAL_JOB_MS } from './job-schedules';
import { runsJobs } from '../common/process/process-role';
import { SignupTrackerService } from '../modules/signup-tracker/signup-tracker.service';

/** Every job shares one queue (src/jobs/job-queue.ts, AGENTS.md §9a). */
export const SIGNUP_TRACKER_QUEUE = LABOURA_JOBS_QUEUE;
export const SIGNUP_TRACKER_SWEEP = 'sweep-signup-tracker';

/**
 * Every few minutes: unfinished app sign-ups (customer app proposal 4.2).
 * Brings each due sign-up's stage up to date from the records, sends the
 * reminders that are due (30 minutes, 4 hours), creates "sign-up help" call
 * tasks on the next working morning (2 working hours after stopping at
 * payment; 4 hours for a business) for the agent the assignment rules pick,
 * closes a sign-up after 3 tries over 3 days, and turns "Call me back"
 * requests into call tasks. Times are CEO settings (signup-settings.ts);
 * working days skip weekly days off and the Holiday list. Each sign-up is
 * processed under its own Postgres advisory lock (SignupTrackerService.process),
 * so a run of this job and the app's own call never work on one sign-up at once.
 */
@Injectable()
export class SignupTrackerJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignupTrackerJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly tracker: SignupTrackerService,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, SIGNUP_TRACKER_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(SIGNUP_TRACKER_SWEEP, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'signup-tracker-scheduler',
      { every: INTERVAL_JOB_MS.signupTracker },
      { name: SIGNUP_TRACKER_SWEEP, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(now: Date = this.tracker.now()) {
    return this.tracker.sweep(now);
  }

  async onModuleInit(): Promise<void> {
    if (!runsJobs()) return;
    await startScheduledJob({
      name: SIGNUP_TRACKER_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not initialize SignupTrackerJob BullMQ worker: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(SIGNUP_TRACKER_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
