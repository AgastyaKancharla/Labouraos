import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobSeekerService } from '../modules/job-seeker/job-seeker.service';

export const NO_PICKUP_EVALUATION_QUEUE = 'no-pickup-evaluation';
export const NO_PICKUP_EVALUATION_JOB = 'daily-no-pickup-evaluation';

export interface EvaluationResult {
  evaluated: number;
  hitsRecorded: number;
  hitJobSeekerIds: string[];
}

@Injectable()
export class NoPickupEvaluationJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NoPickupEvaluationJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSeekerService: JobSeekerService,
  ) {}

  get redisConnection() {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
    };
  }

  async onModuleInit() {
    // Queue and Worker can be initialized if Redis is reachable,
    // but we don't crash app bootstrap if Redis is not running.
    try {
      this.getQueue();
      this.getWorker();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not connect BullMQ queue to Redis: ${msg}`);
    }
  }

  getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(NO_PICKUP_EVALUATION_QUEUE, {
        connection: this.redisConnection,
      });
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        NO_PICKUP_EVALUATION_QUEUE,
        async () => {
          return await this.evaluateNoPickups();
        },
        {
          connection: this.redisConnection,
        },
      );

      this.worker.on('error', (err) => {
        this.logger.error(`BullMQ worker error: ${err.message}`);
      });
    }
    return this.worker;
  }

  async scheduleDailyJob(pattern = '0 0 * * *'): Promise<void> {
    const queue = this.getQueue();
    await queue.upsertJobScheduler(
      'daily-no-pickup-evaluation-scheduler',
      { pattern },
      {
        name: NO_PICKUP_EVALUATION_JOB,
      },
    );
  }

  async triggerJob(): Promise<void> {
    const queue = this.getQueue();
    await queue.add(NO_PICKUP_EVALUATION_JOB, {});
  }

  /**
   * Scans all active job seekers.
   * If a job seeker has a qualifying AM+PM no-pickup pattern plus WhatsApp/SMS
   * logged for the same day that hasn't already been converted into a hit,
   * calls recordHit(..., 'no_pickup') automatically.
   *
   * Idempotent: running on the same day's data does not record duplicate hits
   * because qualifying contact attempts are linked to hitId upon recording.
   */
  async evaluateNoPickups(): Promise<EvaluationResult> {
    const activeJobSeekers = await this.prisma.jobSeeker.findMany({
      where: { status: 'active' },
      select: { id: true, code: true },
      orderBy: { createdAt: 'asc' },
    });

    let hitsRecorded = 0;
    const hitJobSeekerIds: string[] = [];

    for (const js of activeJobSeekers) {
      try {
        const result = await this.jobSeekerService.recordHit(
          js.id,
          'no_pickup',
          'Automated daily no-pickup evaluation',
          'system',
        );
        hitsRecorded++;
        hitJobSeekerIds.push(result.jobSeekerId);
      } catch {
        // Expected when job seeker does not have qualifying unconsumed attempts
        // or is already deactivated
        continue;
      }
    }

    return {
      evaluated: activeJobSeekers.length,
      hitsRecorded,
      hitJobSeekerIds,
    };
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  async onModuleDestroy() {
    await this.close();
  }
}

