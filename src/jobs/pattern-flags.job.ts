import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { PatternFlagService, PatternFlagResults } from '../modules/review-flag/pattern-flag.service';
import { dailyInIndia } from './job-schedules';

export const PATTERN_FLAGS_QUEUE = 'pattern-flags';
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
      this.queue = new Queue(PATTERN_FLAGS_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Pattern flags queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        PATTERN_FLAGS_QUEUE,
        async () => recordJobRun(this.prisma, PATTERN_FLAGS_SWEEP, () => this.process()),
        { connection: this.connection },
      );
      this.worker.on('error', (error) => this.logger.error(`Pattern flags worker error: ${error.message}`));
    }
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
    if (process.env.PROCESS_ROLE !== 'worker') return;
    try {
      await this.schedule();
      this.getWorker();
    } catch (error) {
      this.logger.warn(`Could not initialize PatternFlagsJob BullMQ worker: ${(error as Error).message}`);
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
