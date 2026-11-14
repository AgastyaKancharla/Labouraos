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
import { JobHandler, jobQueue, startScheduledJob } from './job-queue';
import { recordJobRun } from './job-run-recorder';
import { INTERVAL_JOB_MS } from './job-schedules';

/** Every job shares one queue (LABOURA_JOBS_QUEUE; see job-queue.ts). */
export { CUSTOMER_PUSH_QUEUE };
/** The scheduled round's job name (and its JobRun name). */
export const CUSTOMER_PUSH_ROUND = 'send-due-customer-pushes';

/**
 * Customer app pushes (Agent C). Every minute, and whenever a notification
 * is queued (a "send now" kick from the API), sends the pushes that are due
 * through Expo's push service (mock on the test setup), with quiet hours and
 * the daily cap (CustomerPushSenderService). About 15 minutes after sending
 * it checks Expo's receipts and removes the tokens of uninstalled apps.
 *
 * Three job names on the shared queue, all run by the shared worker:
 *   - CUSTOMER_PUSH_ROUND (scheduled, leaves a JobRun row);
 *   - CUSTOMER_PUSH_SEND_NOW (one-off kick; no JobRun row, it would flood it);
 *   - CUSTOMER_PUSH_CHECK_RECEIPTS (one-off, delayed; no JobRun row).
 * The round and the kick never overlap in one process (as when this job had
 * its own worker with concurrency 1), so the daily cap is counted once.
 *
 * Push is never a contact attempt (C17); this job writes no ContactAttempt.
 */
@Injectable()
export class CustomerPushJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CustomerPushJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  /** The send in progress in this process: the round and a kick wait for each other. */
  private sending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly sender: CustomerPushSenderService,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for the scheduled round (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, CUSTOMER_PUSH_ROUND, () => this.process());

  /** What the shared job worker runs for a "send now" kick and a receipt check. */
  readonly handleOneOff: JobHandler = (job: Job) => this.handleJob(job);

  getWorker(): Worker {
    this.worker = jobQueue.worker(CUSTOMER_PUSH_ROUND, this.handle);
    return this.worker;
  }

  /** The two one-off kinds of job: a "send now" kick and a receipt check. */
  async handleJob(job: Pick<Job, 'name' | 'data'>) {
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
  async process(now?: Date) {
    const run = this.sending.then(() => this.sendDue(now ?? this.sender.now()));
    this.sending = run.catch(() => undefined);
    return run;
  }

  private async sendDue(now: Date) {
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
    // Only a process that runs jobs handles pushes. The web process still
    // queues "send now" kicks on the shared queue (CustomerPushKick).
    if (!runsJobs()) return;
    jobQueue.register(CUSTOMER_PUSH_SEND_NOW, this.handleOneOff);
    jobQueue.register(CUSTOMER_PUSH_CHECK_RECEIPTS, this.handleOneOff);
    await startScheduledJob({
      name: CUSTOMER_PUSH_ROUND,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not initialize CustomerPushJob BullMQ worker: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling these jobs here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(CUSTOMER_PUSH_ROUND);
    jobQueue.release(CUSTOMER_PUSH_SEND_NOW);
    jobQueue.release(CUSTOMER_PUSH_CHECK_RECEIPTS);
    this.worker = null;
    this.queue = null;
  }
}
