import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { WeeklyReportService, WeeklyRunResult } from '../modules/weekly-report/weekly-report.service';
import { weeklyInIndia } from './job-schedules';

export const WEEKLY_REPORT_QUEUE = 'weekly-report';
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
      this.queue = new Queue(WEEKLY_REPORT_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Weekly report queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        WEEKLY_REPORT_QUEUE,
        async () => recordJobRun(this.prisma, WEEKLY_REPORT_RUN, () => this.process()),
        { connection: this.connection },
      );
      this.worker.on('error', (error) => this.logger.error(`Weekly report worker error: ${error.message}`));
    }
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
    if (process.env.PROCESS_ROLE !== 'worker') return;
    try {
      await this.schedule();
      this.getWorker();
    } catch (error) {
      this.logger.warn(`Could not initialize WeeklyReportJob BullMQ worker: ${(error as Error).message}`);
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
