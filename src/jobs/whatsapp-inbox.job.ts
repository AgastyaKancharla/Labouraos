import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { INTERVAL_JOB_MS } from './job-schedules';
import { runsJobs } from '../common/process/process-role';
import { WhatsAppInboxService } from '../modules/whatsapp-inbox/whatsapp-inbox.service';
import { WhatsAppEventsService } from '../modules/whatsapp-inbox/whatsapp-events.service';
import { WhatsAppInboxClock } from '../modules/whatsapp-inbox/whatsapp-inbox.clock';

/** Every job shares one queue (src/jobs/job-queue.ts, AGENTS.md §9a). */
export const WHATSAPP_INBOX_QUEUE = LABOURA_JOBS_QUEUE;
export const WHATSAPP_INBOX_SWEEP = 'sweep-whatsapp-inbox';

/**
 * Every 2 minutes (Master Guide rev 202, 21 Nov): hands out WhatsApp
 * conversations and referral partners' leads to call agents on shift (queued
 * ones at shift start), counts working waiting time, rings the Team Lead after
 * 15 working minutes unanswered and the Manager after 2 hours, and sends the
 * automatic event messages (registration done, stopped part-way, stuck at
 * payment) with SMS as fallback.
 */
@Injectable()
export class WhatsAppInboxJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppInboxJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly inbox: WhatsAppInboxService,
    private readonly events: WhatsAppEventsService,
    private readonly clock: WhatsAppInboxClock,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, WHATSAPP_INBOX_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(WHATSAPP_INBOX_SWEEP, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'whatsapp-inbox-scheduler',
      { every: INTERVAL_JOB_MS.whatsappInbox },
      { name: WHATSAPP_INBOX_SWEEP, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(now: Date = this.clock.now()) {
    const inbox = await this.inbox.sweep(now);
    const events = await this.events.sweep(now);
    return { inbox, events };
  }

  async onModuleInit(): Promise<void> {
    if (!runsJobs()) return;
    await startScheduledJob({
      name: WHATSAPP_INBOX_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not initialize WhatsAppInboxJob BullMQ worker: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(WHATSAPP_INBOX_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
