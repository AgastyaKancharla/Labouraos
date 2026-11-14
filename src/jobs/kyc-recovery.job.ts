import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { JobHandler, LABOURA_JOBS_QUEUE, jobQueue, startScheduledJob } from './job-queue';
import { PrismaService } from '../common/prisma/prisma.service';
import { recordJobRun } from './job-run-recorder';
import { KycRecoveryService } from '../common/kyc/kyc-recovery.service';
import { INTERVAL_JOB_MS } from './job-schedules';
import { runsJobs } from '../common/process/process-role';

/** Every job shares one queue (kyc-recovery was its own queue before; see job-queue.ts). */
export const KYC_RECOVERY_QUEUE = LABOURA_JOBS_QUEUE;
export const KYC_RECOVERY_SWEEP = 'probe-id-check-recovery';

@Injectable()
export class KycRecoveryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KycRecoveryJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly recovery: KycRecoveryService,
    /** Records a JobRun row for every scheduled run (optional only for unit tests). */
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  getQueue(): Queue {
    this.queue = jobQueue.queue();
    return this.queue;
  }

  /** What the shared job worker runs for this job (src/jobs/job-queue.ts). */
  readonly handle: JobHandler = () => recordJobRun(this.prisma, KYC_RECOVERY_SWEEP, () => this.process());

  getWorker(): Worker {
    this.worker = jobQueue.worker(KYC_RECOVERY_SWEEP, this.handle);
    return this.worker;
  }

  async schedule(): Promise<void> {
    await this.getQueue().upsertJobScheduler(
      'kyc-recovery-scheduler',
      { every: INTERVAL_JOB_MS.kycRecovery },
      { name: KYC_RECOVERY_SWEEP },
    );
  }

  async triggerJob(): Promise<string | undefined> {
    const job = await this.getQueue().add(KYC_RECOVERY_SWEEP, { requestedAt: new Date().toISOString() });
    return job.id;
  }

  process() {
    return this.recovery.checkAndRecover();
  }

  async onModuleInit(): Promise<void> {
    if (!runsJobs()) return;
    await startScheduledJob({
      name: KYC_RECOVERY_SWEEP,
      handler: this.handle,
      schedule: () => this.schedule(),
      startWorker: () => this.getWorker(),
      onError: (message) => this.logger.warn(`Could not register KYC recovery probe: ${message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Stops handling this job here. The shared queue and Worker stay up (JobQueueLifecycle stops them at shutdown). */
  async close(): Promise<void> {
    jobQueue.release(KYC_RECOVERY_SWEEP);
    this.worker = null;
    this.queue = null;
  }
}
