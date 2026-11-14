import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { AttendanceService } from '../modules/attendance/attendance.service';
import { DaysToFirstInterviewService } from '../modules/growth/days-to-first-interview.service';
import { DAYS_TO_FIRST_INTERVIEW_ALERT_DAYS } from '../modules/growth/growth.constants';
import { NotificationService } from '../modules/notification/notification.service';
import { NotificationSourcesService } from '../modules/notification/notification-sources.service';
import { RefundPriorityService } from '../modules/refund-priority/refund-priority.service';
import { INTERVAL_JOB_MS } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (notification-sweep was its own queue before; see job-queue.ts). */
export const NOTIFICATION_SWEEP_QUEUE = LABOURA_JOBS_QUEUE;
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
    private readonly refundPriority: RefundPriorityService,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, NOTIFICATION_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(NOTIFICATION_SWEEP, this.handle);
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
    // Task 7: someone entering the close-to-refund window gets on the bells; leaving it clears them.
    const refundPriority = await this.sources.safely('refund priority', () => this.refundPriority.syncBells(now));
    return { attendance, sources, firstInterview, refundPriority };
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
    if (!runsJobs()) return;
    await startScheduledJob({
      name: NOTIFICATION_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not initialize NotificationSweepJob BullMQ worker: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(NOTIFICATION_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
