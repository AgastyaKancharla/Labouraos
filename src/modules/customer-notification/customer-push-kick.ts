import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CUSTOMER_PUSH_QUEUE, CUSTOMER_PUSH_SEND_NOW } from './customer-notification.constants';

const KICK_TIMEOUT_MS = 3000;

/**
 * Tells the background worker "there is a push to send now", so a push goes
 * out in seconds instead of waiting for the worker's one-minute round. The
 * inbox row is already saved with pushStatus "queued" before this runs, so a
 * kick that fails (Redis down) loses nothing: the next round sends it.
 *
 * Same shape as RecordingCopyJob.schedule (LESSONS L14): a short timeout so a
 * Redis outage never makes a payment confirmation or an offer hang.
 */
@Injectable()
export class CustomerPushKick {
  private readonly logger = new Logger(CustomerPushKick.name);

  async kick(): Promise<void> {
    let queue: Queue | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      queue = new Queue(CUSTOMER_PUSH_QUEUE, { connection: this.connection() });
      queue.on('error', () => undefined);
      await Promise.race([
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('push queue did not answer')), KICK_TIMEOUT_MS);
        }),
        // One waiting kick is enough: the worker sends everything that is due.
        queue.add(CUSTOMER_PUSH_SEND_NOW, {}, { jobId: CUSTOMER_PUSH_SEND_NOW, removeOnComplete: true, removeOnFail: true }),
      ]);
    } catch (error) {
      this.logger.warn(`Push kick skipped (the worker's next round sends it): ${(error as Error).message}`);
    } finally {
      if (timer) clearTimeout(timer);
      if (queue) {
        const closing = queue;
        await Promise.race([closing.close(), new Promise((resolve) => setTimeout(resolve, 1000).unref?.())]).catch(() => undefined);
      }
    }
  }

  private connection() {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null as null,
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 5000,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    };
  }
}
