import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { InterviewService } from '../modules/vacancy/interview.service';
import { PlacementService } from '../modules/placement/placement.service';
import { FieldSellingService } from '../modules/field-selling/field-selling.service';
import { INTERVAL_JOB_MS } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (interview-reply-deadlines was its own queue before; see job-queue.ts). */
export const INTERVIEW_REPLY_QUEUE = LABOURA_JOBS_QUEUE;
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

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, INTERVIEW_REPLY_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(INTERVIEW_REPLY_SWEEP, this.handle);
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
    await startScheduledJob({
      name: INTERVIEW_REPLY_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not register interview reply deadlines: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(INTERVIEW_REPLY_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
