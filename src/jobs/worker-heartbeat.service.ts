import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  redisClientOptions,
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
  WorkerHeartbeatValue,
} from '../common/redis/worker-heartbeat';
import { processRole, runsJobs } from '../common/process/process-role';

const BEAT_TIMEOUT_MS = 5000;

/**
 * Lets the web service see that the background worker is alive. Runs in every
 * process that runs the jobs (PROCESS_ROLE=worker, or `all` on the free tier).
 *
 * In production a worker that cannot write its first heartbeat cannot reach
 * Redis, so no background job would ever run. It refuses to start instead,
 * and Render restarts it until Redis answers. A single `all` process keeps
 * serving the site instead (it is the only web service on the free tier);
 * /health/ready then reports the worker and the job schedules as missing.
 */
@Injectable()
export class WorkerHeartbeatService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private client: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;

  async onApplicationBootstrap(): Promise<void> {
    if (!runsJobs()) return;

    const ok = await this.beat();
    if (!ok && process.env.NODE_ENV === 'production' && processRole() === 'worker') {
      const { host, port } = redisClientOptions();
      await this.stop();
      throw new Error(
        `Worker cannot reach Redis at ${host}:${port}; no background job would run. ` +
          'Check REDIS_HOST, REDIS_PORT and REDIS_TLS on the worker in the Render dashboard.',
      );
    }

    this.timer = setInterval(() => void this.beat(), WORKER_HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Writes one heartbeat. Returns false (and logs) when Redis does not answer. */
  async beat(now: Date = new Date()): Promise<boolean> {
    const value: WorkerHeartbeatValue = { at: now.toISOString(), pid: process.pid };
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.getClient().set(
          WORKER_HEARTBEAT_KEY,
          JSON.stringify(value),
          'EX',
          WORKER_HEARTBEAT_TTL_SECONDS,
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`timed out after ${BEAT_TIMEOUT_MS}ms`)),
            BEAT_TIMEOUT_MS,
          );
        }),
      ]);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Worker heartbeat could not be written to Redis: ${message}`);
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  getClient(): Redis {
    if (!this.client) {
      this.client = new Redis({
        ...redisClientOptions(),
        maxRetriesPerRequest: 1,
      });
      // Connection errors surface through beat(); stop ioredis printing each retry.
      this.client.on('error', () => undefined);
    }
    return this.client;
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.client) {
      const client = this.client;
      this.client = null;
      client.disconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }
}
