import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { WeeklyReportService, WeeklyRunResult } from '../modules/weekly-report/weekly-report.service';
import { weeklyInIndia } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (weekly-report was its own queue before; see job-queue.ts). */
export const WEEKLY_REPORT_QUEUE = LABOURA_JOBS_QUEUE;
export const WEEKLY_REPORT_RUN = 'monday-weekly-report';

/**
 * Every Monday at 9 AM India time (MG-Reports: "sent every Monday at 9 AM"):
 * last week's report for each Manager's teams and for the CEO's whole company,
 * kept as a snapshot and announced with a bell. Only the worker process
 * schedules and runs it, and a week already kept is never built twice.
 */
@Injectable()
export class WeeklyReportJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeeklyReportJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly reports: WeeklyReportService,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, WEEKLY_REPORT_RUN, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(WEEKLY_REPORT_RUN, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'monday-weekly-report-scheduler',
      weeklyInIndia('weeklyReport'),
      {
        name: WEEKLY_REPORT_RUN,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
    );
  }

  async process(now = new Date()): Promise<WeeklyRunResult> {
    return this.reports.run(now);
  }

  async onModuleInit(): Promise<void> {
    // Only the worker process runs jobs and registers schedulers, so the web
    // and worker processes never both run the Monday report.
    if (!runsJobs()) return;
    await startScheduledJob({
      name: WEEKLY_REPORT_RUN,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not initialize WeeklyReportJob BullMQ worker: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(WEEKLY_REPORT_RUN);
    this.worker = null;
    this.queue = null;
  }
}
