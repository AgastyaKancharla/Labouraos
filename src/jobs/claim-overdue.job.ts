import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { PlacementService } from '../modules/placement/placement.service';
import { dailyInIndia } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (claim-overdue was its own queue before; see job-queue.ts). */
export const CLAIM_OVERDUE_QUEUE = LABOURA_JOBS_QUEUE;
export const CLAIM_OVERDUE_SWEEP = 'daily-claim-overdue';

@Injectable()
export class ClaimOverdueJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaimOverdueJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly placements: PlacementService,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, CLAIM_OVERDUE_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(CLAIM_OVERDUE_SWEEP, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'daily-claim-overdue-scheduler',
      dailyInIndia('claimOverdue'),
      {
        name: CLAIM_OVERDUE_SWEEP,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
    );
  }

  async process(now = new Date()): Promise<{ raised: number }> {
    const raised = await this.placements.checkOverdueClaims(now);
    return { raised };
  }

  async onModuleInit(): Promise<void> {
    // Only the worker process runs jobs and registers schedulers. The web
    // process may still build the queue on demand to enqueue a manual run.
    if (!runsJobs()) return;
    await startScheduledJob({
      name: CLAIM_OVERDUE_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not initialize ClaimOverdueJob BullMQ worker: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(CLAIM_OVERDUE_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
