import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { sharedRedis, whenRedisReady } from '../common/redis/redis-connections';
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
 *
 * Writes over the shared Redis connection; a beat while Redis is down is
 * skipped (never queued to run late).
 */
@Injectable()
export class WorkerHeartbeatService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private timer: NodeJS.Timeout | null = null;

  async onApplicationBootstrap(): Promise<void> {
    if (!runsJobs()) return;

    if (processRole() !== 'worker') {
      // PROCESS_ROLE=all also serves the site: never hold up its start-up.
      void this.beat();
      this.timer = setInterval(() => void this.beat(), WORKER_HEARTBEAT_INTERVAL_MS);
      this.timer.unref?.();
      return;
    }

    const ok = await this.beat();
    if (!ok && process.env.NODE_ENV === 'production') {
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
      const client = this.getClient();
      await whenRedisReady(client, BEAT_TIMEOUT_MS);
      await Promise.race([
        client.set(
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

  /** The shared connection (never closed here; JobQueueLifecycle closes it at shutdown). */
  getClient(): Redis {
    return sharedRedis();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }
}
