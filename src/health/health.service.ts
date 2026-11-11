import { Injectable, Logger } from '@nestjs/common';
import * as net from 'node:net';
import * as tls from 'node:tls';
import Redis from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  redisClientOptions,
  WORKER_HEARTBEAT_CHECK_SETTING,
  WORKER_HEARTBEAT_KEY,
  WorkerHeartbeatValue,
} from '../common/redis/worker-heartbeat';

export interface WorkerHeartbeatStatus {
  status: 'alive' | 'missing' | 'unreachable';
  lastBeatAt: string | null;
  secondsAgo: number | null;
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
    const [dbResult, redisResult, sweep, worker] = await Promise.all([
      this.checkDatabase(timeoutMs),
      this.checkRedis(timeoutMs),
      this.checkSweepInfo(),
      checkWorker ? this.checkWorkerHeartbeat(timeoutMs) : Promise.resolve(undefined),
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

    return {
      ready: failed.length === 0,
      failed,
      errors,
      sweep,
      ...(worker ? { worker } : {}),
    };
  }

  /** Reads the heartbeat the worker writes to Redis every 30 seconds. */
  async checkWorkerHeartbeat(
    timeoutMs = 2000,
    now: Date = new Date(),
  ): Promise<WorkerHeartbeatStatus> {
    const client = new Redis({
      ...redisClientOptions(),
      connectTimeout: timeoutMs,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined);
    let timer: NodeJS.Timeout | undefined;
    try {
      const raw = await Promise.race([
        client.connect().then(() => client.get(WORKER_HEARTBEAT_KEY)),
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
      client.disconnect();
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

  async checkRedis(timeoutMs = 2000): Promise<{ healthy: boolean; error?: string }> {
    let host = process.env.REDIS_HOST || 'localhost';
    let port = Number(process.env.REDIS_PORT) || 6379;
    let isTls = process.env.REDIS_TLS === 'true';

    if (process.env.REDIS_URL) {
      try {
        const parsed = new URL(process.env.REDIS_URL);
        host = parsed.hostname;
        port = Number(parsed.port) || 6379;
        if (parsed.protocol === 'rediss:') {
          isTls = true;
        }
      } catch {
        // Fall back to host/port
      }
    }

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const socket = isTls
          ? tls.connect({ host, port, timeout: timeoutMs, servername: host })
          : net.createConnection({ host, port, timeout: timeoutMs });

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            socket.destroy();
            reject(new Error(`Redis connection to ${host}:${port} timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);

        const cleanup = () => {
          settled = true;
          clearTimeout(timer);
        };

        const onConnect = () => {
          if (!settled) {
            cleanup();
            socket.destroy();
            resolve();
          }
        };

        socket.on('connect', onConnect);
        socket.on('secureConnect', onConnect);

        socket.on('error', (err: Error) => {
          if (!settled) {
            cleanup();
            socket.destroy();
            reject(err);
          }
        });

        socket.on('timeout', () => {
          if (!settled) {
            cleanup();
            socket.destroy();
            reject(new Error(`Redis connection to ${host}:${port} timed out after ${timeoutMs}ms`));
          }
        });
      });

      return { healthy: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Readiness Redis check failed: ${msg}`);
      return { healthy: false, error: msg };
    }
  }
}
