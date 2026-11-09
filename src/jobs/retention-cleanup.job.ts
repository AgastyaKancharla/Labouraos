import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { RetentionService, RetentionSummary } from '../modules/retention/retention.service';

export const RETENTION_CLEANUP_QUEUE = 'retention-cleanup';
export const RETENTION_CLEANUP_SWEEP = 'daily-retention-cleanup';

@Injectable()
export class RetentionCleanupJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionCleanupJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly retentionService: RetentionService) {}

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
      this.queue = new Queue(RETENTION_CLEANUP_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Retention cleanup queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        RETENTION_CLEANUP_QUEUE,
        async (job) => this.process(job.data?.now ? new Date(job.data.now) : new Date(), {
          dryRun: Boolean(job.data?.dryRun),
        }),
        { connection: this.connection },
      );
      this.worker.on('error', (error) => this.logger.error(`Retention cleanup worker error: ${error.message}`));
    }
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'daily-retention-cleanup-scheduler',
      { every: 86_400_000 },
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
    if (process.env.PROCESS_ROLE !== 'worker') return;
    try {
      await this.schedule();
      this.getWorker();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not register retention cleanup job: ${message}`);
      await this.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    await Promise.all([this.worker?.close(), this.queue?.close()]);
    this.worker = null;
    this.queue = null;
  }
}
