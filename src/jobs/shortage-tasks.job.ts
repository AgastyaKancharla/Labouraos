import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { ShortageTaskService, ShortageSweepResult } from '../modules/growth/shortage-task.service';
import { dailyInIndia } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (shortage-tasks was its own queue before; see job-queue.ts). */
export const SHORTAGE_TASKS_QUEUE = LABOURA_JOBS_QUEUE;
export const SHORTAGE_TASKS_SWEEP = 'daily-shortage-tasks';

@Injectable()
export class ShortageTasksJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShortageTasksJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly shortageTasks: ShortageTaskService,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, SHORTAGE_TASKS_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(SHORTAGE_TASKS_SWEEP, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'daily-shortage-tasks-scheduler',
      dailyInIndia('shortageTasks'),
      {
        name: SHORTAGE_TASKS_SWEEP,
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
      SHORTAGE_TASKS_SWEEP,
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

  async process(now = new Date()): Promise<ShortageSweepResult> {
    return this.shortageTasks.sweep(now);
  }

  async onModuleInit(): Promise<void> {
    // Only the worker process runs jobs and registers schedulers. The web
    // process may still build the queue on demand to enqueue a manual run.
    if (!runsJobs()) return;
    await startScheduledJob({
      name: SHORTAGE_TASKS_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not initialize ShortageTasksJob BullMQ worker: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(SHORTAGE_TASKS_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
