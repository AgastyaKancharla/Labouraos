import { Injectable, Logger } from '@nestjs/common';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { PrismaService } from '../common/prisma/prisma.service';

export interface ReadinessCheckResult {
  ready: boolean;
  failed: string[];
  errors: Record<string, string>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkReadiness(timeoutMs = 2000): Promise<ReadinessCheckResult> {
    const failed: string[] = [];
    const errors: Record<string, string> = {};

    const [dbResult, redisResult] = await Promise.all([
      this.checkDatabase(timeoutMs),
      this.checkRedis(timeoutMs),
    ]);

    if (!dbResult.healthy) {
      failed.push('postgres');
      errors.postgres = dbResult.error ?? 'Database query failed or timed out';
    }

    if (!redisResult.healthy) {
      failed.push('redis');
      errors.redis = redisResult.error ?? 'Redis connection failed or timed out';
    }

    return {
      ready: failed.length === 0,
      failed,
      errors,
    };
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
