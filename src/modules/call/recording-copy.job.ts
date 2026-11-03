import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  RECORDING_DOWNLOADER,
  RECORDING_STORAGE,
  RecordingDownloader,
  RecordingStorage,
} from './recording-storage';

export const RECORDING_COPY_QUEUE = 'recording-copy';

@Injectable()
export class RecordingCopyJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecordingCopyJob.name);
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RECORDING_STORAGE) private readonly storage: RecordingStorage,
    @Inject(RECORDING_DOWNLOADER) private readonly downloader: RecordingDownloader,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.PROCESS_ROLE !== 'worker') {
      return;
    }
    try {
      this.worker = new Worker(
        RECORDING_COPY_QUEUE,
        async (job: { data: { callRecordId: string; recordingUrl: string } }) => {
          await this.run(job.data.callRecordId, job.data.recordingUrl);
        },
        { connection: this.connection() },
      );
    } catch (err) {
      this.logger.warn(`Recording copy worker did not start: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
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
    const queue = new Queue(RECORDING_COPY_QUEUE, { connection: this.connection() });
    try {
      await queue.add(
        'copy-recording',
        { callRecordId, recordingUrl },
        {
          jobId: `recording-copy-${callRecordId}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 30000 },
          removeOnComplete: true,
        },
      );
    } finally {
      await queue.close();
    }
  }

  private connection() {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null as null,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    };
  }
}
