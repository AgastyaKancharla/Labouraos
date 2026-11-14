import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { INTERVAL_JOB_MS } from './job-schedules';
import { runsJobs } from '../common/process/process-role';
import { SignupTrackerService } from '../modules/signup-tracker/signup-tracker.service';

export const SIGNUP_TRACKER_QUEUE = 'signup-tracker';
export const SIGNUP_TRACKER_SWEEP = 'sweep-signup-tracker';

/**
 * Every few minutes: unfinished app sign-ups (customer app proposal 4.2).
 * Brings each due sign-up's stage up to date from the records, sends the
 * reminders that are due (30 minutes, 4 hours), creates "sign-up help" call
 * tasks on the next working morning (2 working hours after stopping at
 * payment; 4 hours for a business) for the agent the assignment rules pick,
 * closes a sign-up after 3 tries over 3 days, and turns "Call me back"
 * requests into call tasks. Times are CEO settings (signup-settings.ts);
 * working days skip weekly days off and the Holiday list.
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

  private get connection() {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 5000,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    };
  }

  getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(SIGNUP_TRACKER_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Sign-up tracker queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(SIGNUP_TRACKER_QUEUE, async () => recordJobRun(this.prisma, SIGNUP_TRACKER_SWEEP, () => this.process()), {
        connection: this.connection,
      });
      this.worker.on('error', (error) => this.logger.error(`Sign-up tracker worker error: ${error.message}`));
    }
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
    try {
      await this.schedule();
      this.getWorker();
    } catch (error) {
      this.logger.warn(`Could not initialize SignupTrackerJob BullMQ worker: ${(error as Error).message}`);
      await this.onModuleDestroy();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}
