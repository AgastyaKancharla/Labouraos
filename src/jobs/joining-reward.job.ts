import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PlacementService } from '../modules/placement/placement.service';

export const JOINING_REWARD_QUEUE = 'joining-reward';
export const JOINING_REWARD_SWEEP = 'daily-joining-reward';

@Injectable()
export class JoiningRewardJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JoiningRewardJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly placementService: PlacementService) {}

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
      this.queue = new Queue(JOINING_REWARD_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Joining reward queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        JOINING_REWARD_QUEUE,
        async () => this.process(),
        { connection: this.connection },
      );
      this.worker.on('error', (error) => this.logger.error(`Joining reward worker error: ${error.message}`));
    }
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'daily-joining-reward-scheduler',
      { every: 86_400_000 },
      {
        name: JOINING_REWARD_SWEEP,
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
      JOINING_REWARD_SWEEP,
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

  async process(now = new Date()): Promise<{ queued: number }> {
    const queued = await this.placementService.queueJoiningRewards(now);
    return { queued };
  }

  async onModuleInit(): Promise<void> {
    try {
      this.getWorker();
      await this.schedule();
    } catch (error) {
      this.logger.warn(`Could not initialize JoiningRewardJob BullMQ worker: ${(error as Error).message}`);
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
