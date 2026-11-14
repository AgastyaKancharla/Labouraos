import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { pingRedis, sharedRedis, whenRedisReady } from '../common/redis/redis-connections';
import {
  WORKER_HEARTBEAT_CHECK_SETTING,
  WORKER_HEARTBEAT_KEY,
  WorkerHeartbeatValue,
} from '../common/redis/worker-heartbeat';
import { missingSchedules } from '../jobs/job-schedule-check';

export interface WorkerHeartbeatStatus {
  status: 'alive' | 'missing' | 'unreachable';
  lastBeatAt: string | null;
  secondsAgo: number | null;
  error?: string;
}

export interface ScheduleCheckStatus {
  status: 'ok' | 'missing' | 'unreachable';
  /** Keys of the repeating jobs whose schedule is not in Redis. */
  missing: string[];
  error?: string;
}

export interface ReadinessCheckResult {
  ready: boolean;
  failed: string[];
  errors: Record<string, string>;
  sweep?: {
    status: 'healthy' | 'stale';
    hoursElapsed: number | null;
    lastCompletedAt: string | null;
  };
  worker?: WorkerHeartbeatStatus;
  schedules?: ScheduleCheckStatus;
}

/** True when this process should treat a missing worker heartbeat as not ready. */
export function workerHeartbeatCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[WORKER_HEARTBEAT_CHECK_SETTING] === 'true';
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkReadiness(timeoutMs = 2000): Promise<ReadinessCheckResult> {
    const failed: string[] = [];
    const errors: Record<string, string> = {};

    const checkWorker = workerHeartbeatCheckEnabled();
    const [dbResult, redisResult, sweep, worker, schedules] = await Promise.all([
      this.checkDatabase(timeoutMs),
      this.checkRedis(timeoutMs),
      this.checkSweepInfo(),
      checkWorker ? this.checkWorkerHeartbeat(timeoutMs) : Promise.resolve(undefined),
      checkWorker ? this.checkSchedules(timeoutMs) : Promise.resolve(undefined),
    ]);

    if (!dbResult.healthy) {
      failed.push('postgres');
      errors.postgres = dbResult.error ?? 'Database query failed or timed out';
    }

    if (!redisResult.healthy) {
      failed.push('redis');
      errors.redis = redisResult.error ?? 'Redis connection failed or timed out';
    }

    if (worker && worker.status !== 'alive') {
      failed.push('worker');
      errors.worker =
        worker.status === 'missing'
          ? 'No heartbeat from the background worker in the last 2 minutes'
          : `Could not read the worker heartbeat: ${worker.error ?? 'Redis unreachable'}`;
    }

    if (schedules && schedules.status !== 'ok') {
      failed.push('schedules');
      errors.schedules =
        schedules.status === 'missing'
          ? `Job schedules missing from Redis: ${schedules.missing.join(', ')}. They are put back within 10 minutes by the process that runs the jobs; a restart does it at once.`
          : `Could not read the job schedules: ${schedules.error ?? 'Redis unreachable'}`;
    }

    return {
      ready: failed.length === 0,
      failed,
      errors,
      sweep,
      ...(worker ? { worker } : {}),
      ...(schedules ? { schedules } : {}),
    };
  }

  /**
   * Checks that every repeating job still has its schedule in Redis. A free
   * Render Key Value loses them on a restart; without this the jobs would stop
   * while the heartbeat still said "alive".
   */
  async checkSchedules(timeoutMs = 2000): Promise<ScheduleCheckStatus> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // The shared connection: a readiness check opens no connection of its own.
      const client = sharedRedis();
      const missing = await Promise.race([
        whenRedisReady(client, timeoutMs).then(() => missingSchedules(client)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Redis did not answer within ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      return missing.length
        ? { status: 'missing', missing: missing.map((m) => m.key) }
        : { status: 'ok', missing: [] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Readiness job schedule check failed: ${msg}`);
      return { status: 'unreachable', missing: [], error: msg };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Reads the heartbeat the worker writes to Redis every 30 seconds. */
  async checkWorkerHeartbeat(
    timeoutMs = 2000,
    now: Date = new Date(),
  ): Promise<WorkerHeartbeatStatus> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const client = sharedRedis();
      const raw = await Promise.race([
        whenRedisReady(client, timeoutMs).then(() => client.get(WORKER_HEARTBEAT_KEY)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Redis did not answer within ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      if (!raw) {
        return { status: 'missing', lastBeatAt: null, secondsAgo: null };
      }
      let lastBeatAt: string | null = null;
      try {
        lastBeatAt = (JSON.parse(raw) as WorkerHeartbeatValue).at ?? null;
      } catch {
        lastBeatAt = null;
      }
      const beatMs = lastBeatAt ? Date.parse(lastBeatAt) : NaN;
      return {
        status: 'alive',
        lastBeatAt,
        secondsAgo: Number.isNaN(beatMs) ? null : Math.max(0, Math.round((now.getTime() - beatMs) / 1000)),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Readiness worker heartbeat check failed: ${msg}`);
      return { status: 'unreachable', lastBeatAt: null, secondsAgo: null, error: msg };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async checkSweepInfo(): Promise<
    | { status: 'healthy' | 'stale'; hoursElapsed: number | null; lastCompletedAt: string | null }
    | undefined
  > {
    try {
      if (!this.prisma.jobRun) return undefined;
      const latest = await this.prisma.jobRun.findFirst({
        where: {
          jobName: 'daily-no-pickup-evaluation',
          outcome: 'success',
          finishedAt: { not: null },
        },
        orderBy: { finishedAt: 'desc' },
      });
      if (!latest || !latest.finishedAt) {
        return undefined;
      }
      const gapMs = Date.now() - latest.finishedAt.getTime();
      const hoursElapsed = Math.floor(gapMs / (1000 * 60 * 60));
      return {
        status: gapMs > 36 * 60 * 60 * 1000 ? 'stale' : 'healthy',
        hoursElapsed,
        lastCompletedAt: latest.finishedAt.toISOString(),
      };
    } catch {
      return undefined;
    }
  }

  async checkDatabase(timeoutMs = 2000): Promise<{ healthy: boolean; error?: string }> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRawUnsafe('SELECT 1'),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`PostgreSQL query timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      return { healthy: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Readiness database check failed: ${msg}`);
      return { healthy: false, error: msg };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * PING over the shared connection (no new connection per check, so frequent
   * health checks never eat into the Key Value's connection limit). While the
   * connection is down this reports the problem; ioredis keeps reconnecting.
   */
  async checkRedis(timeoutMs = 2000): Promise<{ healthy: boolean; error?: string }> {
    try {
      await pingRedis(timeoutMs);
      return { healthy: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Readiness Redis check failed: ${msg}`);
      return { healthy: false, error: msg };
    }
  }
}
