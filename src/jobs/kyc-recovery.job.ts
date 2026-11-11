import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { KycRecoveryService } from '../common/kyc/kyc-recovery.service';
import { INTERVAL_JOB_MS } from './job-schedules';

export const KYC_RECOVERY_QUEUE = 'kyc-recovery';
export const KYC_RECOVERY_SWEEP = 'probe-id-check-recovery';

@Injectable()
export class KycRecoveryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KycRecoveryJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly recovery: KycRecoveryService) {}

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
      this.queue = new Queue(KYC_RECOVERY_QUEUE, { connection: this.connection });
      this.queue.on('error', (error) => this.logger.warn(`KYC recovery queue error: ${error.message}`));
    }
    return this.queue;
  }

  getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(KYC_RECOVERY_QUEUE, async () => this.process(), { connection: this.connection });
      this.worker.on('error', (error) => this.logger.error(`KYC recovery worker error: ${error.message}`));
    }
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
    if (process.env.PROCESS_ROLE !== 'worker') return;
    try {
      await this.schedule();
      this.getWorker();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not register KYC recovery probe: ${message}`);
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
