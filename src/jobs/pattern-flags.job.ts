import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { PatternFlagService, PatternFlagResults } from '../modules/review-flag/pattern-flag.service';
import { dailyInIndia } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (pattern-flags was its own queue before; see job-queue.ts). */
export const PATTERN_FLAGS_QUEUE = LABOURA_JOBS_QUEUE;
export const PATTERN_FLAGS_SWEEP = 'daily-pattern-flags';

@Injectable()
export class PatternFlagsJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PatternFlagsJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly patternFlagService: PatternFlagService,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, PATTERN_FLAGS_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(PATTERN_FLAGS_SWEEP, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'daily-pattern-flags-scheduler',
      dailyInIndia('patternFlags'),
      {
        name: PATTERN_FLAGS_SWEEP,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
    );
  }

  async triggerJob(): Promise<string | undefined> {
    const job = await this.getQueue().add(
      PATTERN_FLAGS_SWEEP,
      { timestamp: new Date().toISOString() },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    return job.id;
  }

  async process(now = new Date()): Promise<PatternFlagResults> {
    return this.patternFlagService.evaluateAll(now);
  }

  async onModuleInit(): Promise<void> {
    // Only the worker process runs jobs and registers schedulers. The web
    // process may still build the queue on demand to enqueue a manual run.
    if (!runsJobs()) return;
    await startScheduledJob({
      name: PATTERN_FLAGS_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not initialize PatternFlagsJob BullMQ worker: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(PATTERN_FLAGS_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
