import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  RECORDING_DOWNLOADER,
  RECORDING_STORAGE,
  RecordingDownloader,
  RecordingStorage,
} from './recording-storage';
import { runsJobs } from '../../common/process/process-role';
import { jobQueue, LABOURA_JOBS_QUEUE } from '../../jobs/job-queue';

/** Copies go into the shared job queue (they had their own 'recording-copy' queue before; see job-queue.ts). */
export const RECORDING_COPY_QUEUE = LABOURA_JOBS_QUEUE;
export const RECORDING_COPY_JOB = 'copy-recording';
export const RECORDING_QUEUE_TIMEOUT_MS = 5000;

@Injectable()
export class RecordingCopyJob implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RECORDING_STORAGE) private readonly storage: RecordingStorage,
    @Inject(RECORDING_DOWNLOADER) private readonly downloader: RecordingDownloader,
  ) {}

  /** What the shared job worker runs for each queued copy (src/jobs/job-queue.ts). */
  readonly handle = async (job: Job): Promise<void> => {
    const data = job.data as { callRecordId: string; recordingUrl: string };
    await this.run(data.callRecordId, data.recordingUrl);
  };

  async onModuleInit(): Promise<void> {
    // Only a process that runs jobs handles the copies; the shared worker is
    // started by JobQueueLifecycle, so this needs no Redis.
    if (!runsJobs()) {
      return;
    }
    jobQueue.register(RECORDING_COPY_JOB, this.handle);
  }

  async onModuleDestroy(): Promise<void> {
    jobQueue.release(RECORDING_COPY_JOB);
  }

  /** Downloads the provider file into Laboura's storage. Throws if the copy fails. */
  async run(callRecordId: string, recordingUrl: string): Promise<void> {
    const existing = await this.prisma.callRecord.findUnique({
      where: { id: callRecordId },
      select: { recordingStoragePath: true },
    });
    if (!existing || existing.recordingStoragePath) {
      return;
    }
    const bytes = await this.downloader.download(recordingUrl);
    const path = `calls/${callRecordId}.audio`;
    await this.storage.put(path, bytes, 'audio/mpeg');
    await this.prisma.callRecord.update({
      where: { id: callRecordId },
      data: { recordingStoragePath: path },
    });
  }

  /** Queues another attempt. A failure here is logged and not shown to agents. */
  async schedule(callRecordId: string, recordingUrl: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // L14: with Redis down the telephony webhook must not hang; give up after
      // a few seconds (the caller logs it, the recording link stays the vendor's).
      // Uses the shared connection: queueing a copy opens no new connection.
      await Promise.race([
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Recording copy queue did not answer within ${RECORDING_QUEUE_TIMEOUT_MS}ms`)), RECORDING_QUEUE_TIMEOUT_MS);
        }),
        jobQueue.add(
          RECORDING_COPY_JOB,
          { callRecordId, recordingUrl },
          {
            jobId: `recording-copy-${callRecordId}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 30000 },
            removeOnComplete: true,
          },
        ),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
