import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { RetentionService, RetentionSummary } from '../modules/retention/retention.service';
import { dailyInIndia } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (retention-cleanup was its own queue before; see job-queue.ts). */
export const RETENTION_CLEANUP_QUEUE = LABOURA_JOBS_QUEUE;
export const RETENTION_CLEANUP_SWEEP = 'daily-retention-cleanup';

@Injectable()
export class RetentionCleanupJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionCleanupJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly retentionService: RetentionService) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job. Records its own JobRun rows (retention.service.ts). */
  readonly handle: JobHandler = (job) =>
    this.process(job.data?.now ? new Date(job.data.now) : new Date(), {
      dryRun: Boolean(job.data?.dryRun),
    });

  getWorker(): Worker {
    this.worker = jobQueue.worker(RETENTION_CLEANUP_SWEEP, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'daily-retention-cleanup-scheduler',
      dailyInIndia('retentionCleanup'),
      { name: RETENTION_CLEANUP_SWEEP },
    );
  }

  async process(
    now = new Date(),
    options: { dryRun?: boolean } = {},
  ): Promise<RetentionSummary> {
    return this.retentionService.runRetentionCleanup({
      now,
      dryRun: options.dryRun,
    });
  }

  async onModuleInit(): Promise<void> {
    if (!runsJobs()) return;
    await startScheduledJob({
      name: RETENTION_CLEANUP_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not register retention cleanup job: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(RETENTION_CLEANUP_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
