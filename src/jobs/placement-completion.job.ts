import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PlacementService } from '../modules/placement/placement.service';
import { dailyInIndia } from './job-schedules';

export const PLACEMENT_COMPLETION_QUEUE = 'placement-completion';
export const PLACEMENT_COMPLETION_SWEEP = 'daily-placement-completion';

@Injectable()
export class PlacementCompletionJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlacementCompletionJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly placements: PlacementService) {}

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
      this.queue = new Queue(PLACEMENT_COMPLETION_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Placement completion queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        PLACEMENT_COMPLETION_QUEUE,
        async () => this.process(),
        { connection: this.connection },
      );
      this.worker.on('error', (error) => this.logger.error(`Placement completion worker error: ${error.message}`));
    }
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
    if (process.env.PROCESS_ROLE !== 'worker') return;
    try {
      await this.schedule();
      this.getWorker();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not register placement completion job: ${message}`);
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
