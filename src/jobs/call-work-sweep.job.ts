import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { INTERVAL_JOB_MS } from './job-schedules';
import { runsJobs } from '../common/process/process-role';
import { MissedCallAssigner } from '../modules/telephony/missed-call-assigner.service';
import { WorkHandoverService } from '../modules/follow-up/work-handover.service';

/** Every job shares one queue (src/jobs/job-queue.ts, AGENTS.md §9a). */
export const CALL_WORK_SWEEP_QUEUE = LABOURA_JOBS_QUEUE;
export const CALL_WORK_SWEEP = 'sweep-call-work';

/**
 * Every few minutes (21 Nov fixes, Master Guide rev 202): hands out missed
 * calls to agents on shift (at shift start and all day), bells the Team Lead
 * after 15 minutes and the Manager after an hour without a first call back,
 * spreads the open call work of an agent not logged in an hour after their
 * shift start, and gives people and sign-ups back after a leave.
 */
@Injectable()
export class CallWorkSweepJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallWorkSweepJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly missedCalls: MissedCallAssigner,
    private readonly handover: WorkHandoverService,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, CALL_WORK_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(CALL_WORK_SWEEP, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'call-work-sweep-scheduler',
      { every: INTERVAL_JOB_MS.callWorkSweep },
      { name: CALL_WORK_SWEEP, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(now: Date = new Date()) {
    const noShows = await this.handover.sweepNoShows(now);
    const missed = await this.missedCalls.sweep(now);
    const back = await this.handover.returnAfterLeave(now);
    return { missed, noShows, returned: back.returned };
  }

  async onModuleInit(): Promise<void> {
    if (!runsJobs()) return;
    await startScheduledJob({
      name: CALL_WORK_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not initialize CallWorkSweepJob BullMQ worker: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(CALL_WORK_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
