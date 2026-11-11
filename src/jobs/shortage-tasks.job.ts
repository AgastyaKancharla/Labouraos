import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { ShortageTaskService, ShortageSweepResult } from '../modules/growth/shortage-task.service';
import { dailyInIndia } from './job-schedules';

export const SHORTAGE_TASKS_QUEUE = 'shortage-tasks';
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
      this.queue = new Queue(SHORTAGE_TASKS_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Shortage tasks queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        SHORTAGE_TASKS_QUEUE,
        async () => recordJobRun(this.prisma, SHORTAGE_TASKS_SWEEP, () => this.process()),
        { connection: this.connection },
      );
      this.worker.on('error', (error) => this.logger.error(`Shortage tasks worker error: ${error.message}`));
    }
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
    if (process.env.PROCESS_ROLE !== 'worker') return;
    try {
      await this.schedule();
      this.getWorker();
    } catch (error) {
      this.logger.warn(`Could not initialize ShortageTasksJob BullMQ worker: ${(error as Error).message}`);
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
