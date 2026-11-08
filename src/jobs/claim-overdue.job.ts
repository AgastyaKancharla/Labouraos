import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PlacementService } from '../modules/placement/placement.service';

export const CLAIM_OVERDUE_QUEUE = 'claim-overdue';
export const CLAIM_OVERDUE_SWEEP = 'daily-claim-overdue';

@Injectable()
export class ClaimOverdueJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaimOverdueJob.name);
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
      this.queue = new Queue(CLAIM_OVERDUE_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Claim overdue queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        CLAIM_OVERDUE_QUEUE,
        async () => this.process(),
        { connection: this.connection },
      );
      this.worker.on('error', (error) => this.logger.error(`Claim overdue worker error: ${error.message}`));
    }
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'daily-claim-overdue-scheduler',
      { every: 86_400_000 },
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
    try {
      this.getWorker();
      await this.schedule();
    } catch (error) {
      this.logger.warn(`Could not initialize ClaimOverdueJob BullMQ worker: ${(error as Error).message}`);
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
