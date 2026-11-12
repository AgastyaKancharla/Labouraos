import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { InterviewService } from '../modules/vacancy/interview.service';
import { PlacementService } from '../modules/placement/placement.service';
import { FieldSellingService } from '../modules/field-selling/field-selling.service';
import { INTERVAL_JOB_MS } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

export const INTERVIEW_REPLY_QUEUE = 'interview-reply-deadlines';
export const INTERVIEW_REPLY_SWEEP = 'process-due-interview-replies';

@Injectable()
export class InterviewReplyJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InterviewReplyJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly interviews: InterviewService,
    private readonly placements: PlacementService,
    @Optional() private readonly fieldSelling?: FieldSellingService,
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
      this.queue = new Queue(INTERVIEW_REPLY_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Interview reply queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        INTERVIEW_REPLY_QUEUE,
        async () => recordJobRun(this.prisma, INTERVIEW_REPLY_SWEEP, () => this.process()),
        { connection: this.connection },
      );
      this.worker.on('error', (error) => this.logger.error(`Interview reply worker error: ${error.message}`));
    }
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'interview-reply-deadline-scheduler',
      { every: INTERVAL_JOB_MS.interviewReply },
      { name: INTERVIEW_REPLY_SWEEP },
    );
  }

  processDueReplies() {
    return this.interviews.processDueReplies();
  }

  async process() {
    const replies = await this.interviews.processDueReplies();
    const results = await this.interviews.processResultDeadlines();
    const payments = await this.placements.processPaymentDeadlines();
    // Phone interviews (Laboura Field, FA15g): ring both sides at the set time.
    if (!this.fieldSelling) return { replies, results, payments };
    const phoneInterviews = await this.fieldSelling.processDuePhoneInterviews();
    return { replies, results, payments, phoneInterviews };
  }

  async onModuleInit(): Promise<void> {
    if (!runsJobs()) return;
    try {
      await this.schedule();
      this.getWorker();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not register interview reply deadlines: ${message}`);
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
