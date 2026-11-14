import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { AttendanceService } from '../modules/attendance/attendance.service';
import { AttendanceDaysService } from '../modules/attendance/attendance-days.service';
import { LeaveService } from '../modules/attendance/leave.service';
import { dailyInIndia } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (forgotten-logout was its own queue before; see job-queue.ts). */
export const FORGOTTEN_LOGOUT_QUEUE = LABOURA_JOBS_QUEUE;
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
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, FORGOTTEN_LOGOUT_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(FORGOTTEN_LOGOUT_SWEEP, this.handle);
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
    if (!runsJobs()) return;
    await startScheduledJob({
      name: FORGOTTEN_LOGOUT_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not register forgotten logout job: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(FORGOTTEN_LOGOUT_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
