import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { AttendanceService } from '../modules/attendance/attendance.service';
import { AttendanceDaysService } from '../modules/attendance/attendance-days.service';
import { LeaveService } from '../modules/attendance/leave.service';
import { dailyInIndia } from './job-schedules';

export const FORGOTTEN_LOGOUT_QUEUE = 'forgotten-logout';
export const FORGOTTEN_LOGOUT_SWEEP = 'close-forgotten-days';

/**
 * Closes any day left open, then marks yesterday absent for anyone with no
 * login and no approved leave (weekly days off are skipped), and writes the
 * month's leave accrual on the 1st (safe to repeat). 00:00 UTC is 05:30 IST, before the shift starts,
 * so a day still open from yesterday is closed and a new morning is not.
 */
@Injectable()
export class ForgottenLogoutJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ForgottenLogoutJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly attendance: AttendanceService,
    private readonly days: AttendanceDaysService,
    private readonly leave: LeaveService,
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
      this.queue = new Queue(FORGOTTEN_LOGOUT_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Forgotten logout queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        FORGOTTEN_LOGOUT_QUEUE,
        async () => this.process(),
        { connection: this.connection },
      );
      this.worker.on('error', (error) => this.logger.error(`Forgotten logout worker error: ${error.message}`));
    }
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'nightly-forgotten-logout',
      dailyInIndia('forgottenLogout'),
      { name: FORGOTTEN_LOGOUT_SWEEP },
    );
  }

  async process(): Promise<{ closed: number; absent: number; accrued: number }> {
    const { closed } = await this.attendance.closeForgottenDays();
    const { marked } = await this.days.markAbsentDays();
    const { written } = await this.leave.accrueAll();
    return { closed, absent: marked, accrued: written };
  }

  async onModuleInit(): Promise<void> {
    if (process.env.PROCESS_ROLE !== 'worker') return;
    try {
      await this.schedule();
      this.getWorker();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not register forgotten logout job: ${message}`);
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
