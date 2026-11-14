import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { runsJobs } from '../common/process/process-role';
import {
  CUSTOMER_PUSH_CHECK_RECEIPTS,
  CUSTOMER_PUSH_QUEUE,
  CUSTOMER_PUSH_SEND_NOW,
  RECEIPT_CHECK_DELAY_MS,
} from '../modules/customer-notification/customer-notification.constants';
import { CustomerPushSenderService, PushTicketRef } from '../modules/customer-notification/customer-push-sender.service';
import { recordJobRun } from './job-run-recorder';
import { INTERVAL_JOB_MS } from './job-schedules';

export { CUSTOMER_PUSH_QUEUE };
/** The scheduled round's JobRun name. */
export const CUSTOMER_PUSH_ROUND = 'send-due-customer-pushes';

/**
 * Customer app pushes (Agent C). Every minute, and whenever a notification
 * is queued (a "send now" kick from the API), sends the pushes that are due
 * through Expo's push service (mock on the test setup), with quiet hours and
 * the daily cap (CustomerPushSenderService). About 15 minutes after sending
 * it checks Expo's receipts and removes the tokens of uninstalled apps.
 *
 * Push is never a contact attempt (C17); this job writes no ContactAttempt.
 */
@Injectable()
export class CustomerPushJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CustomerPushJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly sender: CustomerPushSenderService,
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
      this.queue = new Queue(CUSTOMER_PUSH_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Customer push queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      // The scheduled round leaves a JobRun row; kicks and receipt checks do not (they would flood it).
      this.worker = new Worker(
        CUSTOMER_PUSH_QUEUE,
        async (job: Job) => (job.name === CUSTOMER_PUSH_ROUND ? recordJobRun(this.prisma, CUSTOMER_PUSH_ROUND, () => this.process()) : this.handle(job)),
        { connection: this.connection },
      );
      this.worker.on('error', (error) => this.logger.error(`Customer push worker error: ${error.message}`));
    }
    return this.worker;
  }

  /** The other two kinds of job on the queue: a "send now" kick and a receipt check. */
  async handle(job: Pick<Job, 'name' | 'data'>) {
    if (job.name === CUSTOMER_PUSH_CHECK_RECEIPTS) {
      const tickets = Array.isArray((job.data as { tickets?: unknown })?.tickets) ? (job.data as { tickets: PushTicketRef[] }).tickets : [];
      return this.sender.checkReceipts(tickets);
    }
    if (job.name === CUSTOMER_PUSH_SEND_NOW) return this.process();
    return null;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'customer-push-scheduler',
      { every: INTERVAL_JOB_MS.customerPush },
      { name: CUSTOMER_PUSH_ROUND, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  /** Sends what is due, then books the receipt check. Returns counts only (JobRun details). */
  async process(now: Date = this.sender.now()) {
    const result = await this.sender.sendDue(now);
    if (result.tickets.length > 0) {
      try {
        await this.getQueue().add(
          CUSTOMER_PUSH_CHECK_RECEIPTS,
          { tickets: result.tickets },
          { delay: RECEIPT_CHECK_DELAY_MS, attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: true, removeOnFail: 100 },
        );
      } catch (error) {
        this.logger.warn(`Could not book the push receipt check: ${(error as Error).message}`);
      }
    }
    const { tickets, ...counts } = result;
    return { ...counts, tickets: tickets.length };
  }

  async onModuleInit(): Promise<void> {
    if (!runsJobs()) return;
    try {
      await this.schedule();
      this.getWorker();
    } catch (error) {
      this.logger.warn(`Could not initialize CustomerPushJob BullMQ worker: ${(error as Error).message}`);
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
