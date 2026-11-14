import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { FollowUpService } from '../modules/follow-up/follow-up.service';
import { FollowUpHandoverService } from '../modules/follow-up/follow-up-handover.service';
import { dailyInIndia } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (follow-up was its own queue before; see job-queue.ts). */
export const FOLLOW_UP_QUEUE = LABOURA_JOBS_QUEUE;
export const FOLLOW_UP_SWEEP = 'daily-follow-up';

@Injectable()
export class FollowUpJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FollowUpJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly followUpService: FollowUpService,
    /** Moves handed-over follow-ups back after the leave (optional only for unit tests). */
    @Optional() private readonly handovers?: FollowUpHandoverService,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, FOLLOW_UP_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(FOLLOW_UP_SWEEP, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'daily-follow-up-scheduler',
      dailyInIndia('followUp'),
      {
        name: FOLLOW_UP_SWEEP,
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
      FOLLOW_UP_SWEEP,
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

  async process(now = new Date()): Promise<{ created: number; missed: number; returned?: number }> {
    // Back first, so a task due after the leave is missed against her, not the teammate.
    const back = this.handovers ? await this.handovers.returnAfterLeave(now) : null;
    const result = await this.followUpService.createScheduledTasks(now);
    return back ? { ...result, returned: back.returned } : result;
  }

  async onModuleInit(): Promise<void> {
    // Only the worker process runs jobs and registers schedulers. The web
    // process may still build the queue on demand to enqueue a manual run.
    if (!runsJobs()) return;
    await startScheduledJob({
      name: FOLLOW_UP_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not initialize FollowUpJob BullMQ worker: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(FOLLOW_UP_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
