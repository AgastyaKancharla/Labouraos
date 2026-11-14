import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { PlacementService } from '../modules/placement/placement.service';
import { dailyInIndia } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (placement-completion was its own queue before; see job-queue.ts). */
export const PLACEMENT_COMPLETION_QUEUE = LABOURA_JOBS_QUEUE;
export const PLACEMENT_COMPLETION_SWEEP = 'daily-placement-completion';

@Injectable()
export class PlacementCompletionJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlacementCompletionJob.name);
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
  readonly handle: JobHandler = () => recordJobRun(this.prisma, PLACEMENT_COMPLETION_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(PLACEMENT_COMPLETION_SWEEP, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'daily-placement-completion-scheduler',
      dailyInIndia('placementCompletion'),
      { name: PLACEMENT_COMPLETION_SWEEP },
    );
  }

  async process(now = new Date()) {
    const completed = await this.placements.completeDay60Placements(now);
    return { completed };
  }

  async onModuleInit(): Promise<void> {
    if (!runsJobs()) return;
    await startScheduledJob({
      name: PLACEMENT_COMPLETION_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not register placement completion job: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(PLACEMENT_COMPLETION_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
