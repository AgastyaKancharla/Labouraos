import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { AttendanceService } from '../modules/attendance/attendance.service';
import { DaysToFirstInterviewService } from '../modules/growth/days-to-first-interview.service';
import { DAYS_TO_FIRST_INTERVIEW_ALERT_DAYS } from '../modules/growth/growth.constants';
import { NotificationService } from '../modules/notification/notification.service';
import { NotificationSourcesService } from '../modules/notification/notification-sources.service';
import { INTERVAL_JOB_MS } from './job-schedules';

export const NOTIFICATION_SWEEP_QUEUE = 'notification-sweep';
export const NOTIFICATION_SWEEP = 'sweep-notifications';

/**
 * Every few minutes: brings every bell up to date with the records (Phase 21
 * Task 6). Event hooks give the immediate bells; this catches everything that
 * changes with the clock alone — a request escalating after 24 or 48 hours,
 * an agent going idle, a break running over while nobody touches the screen —
 * and anything resolved by code that has no hook.
 */
@Injectable()
export class NotificationSweepJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationSweepJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly attendance: AttendanceService,
    private readonly sources: NotificationSourcesService,
    private readonly notifications: NotificationService,
    private readonly daysToFirstInterview: DaysToFirstInterviewService,
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
      this.queue = new Queue(NOTIFICATION_SWEEP_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`Notification sweep queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(NOTIFICATION_SWEEP_QUEUE, async () => this.process(), {
        connection: this.connection,
      });
      this.worker.on('error', (error) => this.logger.error(`Notification sweep worker error: ${error.message}`));
    }
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'notification-sweep-scheduler',
      { every: INTERVAL_JOB_MS.notificationSweep },
      { name: NOTIFICATION_SWEEP, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(now: Date = this.notifications.now()) {
    const attendance = await this.sources.safely('attendance refresh', () => this.attendance.refreshOpenDays());
    const sources = await this.sources.syncAll(now);
    const firstInterview = await this.sources.safely('first interview', () => this.syncFirstInterview(now));
    return { attendance, sources, firstInterview };
  }

  /**
   * N2: a paid job seeker with no interview booked 10 or more days after
   * paying is on his Team Lead's bell until an interview is booked.
   */
  async syncFirstInterview(now: Date) {
    const dir = await this.sources.directory();
    const ceo = dir.ceos()[0];
    if (!ceo) return { opened: 0, cleared: 0 };
    const list = await this.daysToFirstInterview.list(
      { id: ceo.id, role: 'ceo' },
      DAYS_TO_FIRST_INTERVIEW_ALERT_DAYS,
      now,
    );
    const drafts = list.rows.flatMap((row) => {
      const agent = dir.get(row.registeredBy?.id);
      const lead = agent ? (agent.role === 'team_lead' ? agent : dir.chainOf(agent.id).teamLead) : null;
      return this.sources.drafts([lead], {
        kind: 'first_interview_overdue',
        title: `${row.code}: no interview ${row.daysSincePaid} days after paying`,
        body: `${row.trade ?? 'Trade not set'} · ${row.daysLeftOnGuarantee} days left on the guarantee`,
        subjectType: 'job_seeker',
        subjectId: row.jobSeekerId,
      });
    });
    return this.notifications.reconcileKind(
      'first_interview_overdue',
      drafts,
      () => ({ byStaffId: null, reason: 'interview_booked_or_closed' }),
      now,
    );
  }

  async onModuleInit(): Promise<void> {
    if (process.env.PROCESS_ROLE !== 'worker') return;
    try {
      await this.schedule();
      this.getWorker();
    } catch (error) {
      this.logger.warn(`Could not initialize NotificationSweepJob BullMQ worker: ${(error as Error).message}`);
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
