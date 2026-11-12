import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { WorkerHeartbeatService } from './worker-heartbeat.service';
import { HealthService } from '../health/health.service';
import { HealthController } from '../health/health.controller';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
} from '../common/redis/worker-heartbeat';

async function redisReachable(): Promise<boolean> {
  const client = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    lazyConnect: true,
    connectTimeout: 300,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('Worker heartbeat', () => {
  const saved = {
    PROCESS_ROLE: process.env.PROCESS_ROLE,
    NODE_ENV: process.env.NODE_ENV,
    WORKER_HEARTBEAT_CHECK: process.env.WORKER_HEARTBEAT_CHECK,
    REDIS_PORT: process.env.REDIS_PORT,
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) restoreEnv(name, value);
    jest.restoreAllMocks();
  });

  describe('writer (worker process)', () => {
    it('does nothing in the web process', async () => {
      process.env.PROCESS_ROLE = 'web';
      const heartbeat = new WorkerHeartbeatService();
      const beat = jest.spyOn(heartbeat, 'beat');
      await heartbeat.onApplicationBootstrap();
      expect(beat).not.toHaveBeenCalled();
      await heartbeat.onModuleDestroy();
    });

    it('writes the heartbeat key with a 2-minute expiry', async () => {
      const heartbeat = new WorkerHeartbeatService();
      const set = jest.fn().mockResolvedValue('OK');
      jest.spyOn(heartbeat, 'getClient').mockReturnValue({ set } as unknown as Redis);

      await expect(heartbeat.beat(new Date('2026-11-15T10:00:00.000Z'))).resolves.toBe(true);

      expect(set).toHaveBeenCalledWith(
        WORKER_HEARTBEAT_KEY,
        expect.stringContaining('"at":"2026-11-15T10:00:00.000Z"'),
        'EX',
        WORKER_HEARTBEAT_TTL_SECONDS,
      );
      expect(WORKER_HEARTBEAT_TTL_SECONDS).toBe(120);
    });

    it('refuses to start a production worker that cannot reach Redis', async () => {
      process.env.PROCESS_ROLE = 'worker';
      process.env.NODE_ENV = 'production';
      const heartbeat = new WorkerHeartbeatService();
      jest.spyOn(heartbeat, 'beat').mockResolvedValue(false);

      await expect(heartbeat.onApplicationBootstrap()).rejects.toThrow(
        /Worker cannot reach Redis.*no background job would run/,
      );
      await heartbeat.onModuleDestroy();
    });

    it('keeps a non-production worker running (and logging) when Redis is down', async () => {
      process.env.PROCESS_ROLE = 'worker';
      process.env.NODE_ENV = 'test';
      const heartbeat = new WorkerHeartbeatService();
      jest.spyOn(heartbeat, 'beat').mockResolvedValue(false);

      await expect(heartbeat.onApplicationBootstrap()).resolves.toBeUndefined();
      await heartbeat.onModuleDestroy();
    });

    it('returns false instead of throwing when Redis refuses the write', async () => {
      const heartbeat = new WorkerHeartbeatService();
      const set = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      jest.spyOn(heartbeat, 'getClient').mockReturnValue({ set } as unknown as Redis);
      await expect(heartbeat.beat()).resolves.toBe(false);
    });
  });

  describe('readiness (web process)', () => {
    function build() {
      const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ '1': 1 }]) };
      const service = new HealthService(prisma as unknown as PrismaService);
      jest.spyOn(service, 'checkDatabase').mockResolvedValue({ healthy: true });
      jest.spyOn(service, 'checkRedis').mockResolvedValue({ healthy: true });
      jest.spyOn(service, 'checkSweepInfo').mockResolvedValue(undefined);
      // The job-schedule check (same switch as the heartbeat) has its own tests.
      jest.spyOn(service, 'checkSchedules').mockResolvedValue({ status: 'ok', missing: [] });
      return { service, controller: new HealthController(service) };
    }

    it('ignores the worker unless WORKER_HEARTBEAT_CHECK=true', async () => {
      delete process.env.WORKER_HEARTBEAT_CHECK;
      const { service, controller } = build();
      const check = jest.spyOn(service, 'checkWorkerHeartbeat');

      await expect(controller.getReadiness()).resolves.toEqual({
        status: 'ready',
        postgres: 'ok',
        redis: 'ok',
      });
      expect(check).not.toHaveBeenCalled();
    });

    it('answers 503 naming worker when the heartbeat is missing', async () => {
      process.env.WORKER_HEARTBEAT_CHECK = 'true';
      const { service, controller } = build();
      jest
        .spyOn(service, 'checkWorkerHeartbeat')
        .mockResolvedValue({ status: 'missing', lastBeatAt: null, secondsAgo: null });

      try {
        await controller.getReadiness();
        fail('expected 503');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HttpException);
        const http = err as HttpException;
        expect(http.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const body = http.getResponse() as { failed: string[]; errors: Record<string, string> };
        expect(body.failed).toEqual(['worker']);
        expect(body.errors.worker).toMatch(/No heartbeat from the background worker/);
      }
    });

    it('reports the worker as alive when the heartbeat is fresh', async () => {
      process.env.WORKER_HEARTBEAT_CHECK = 'true';
      const { service, controller } = build();
      const alive = {
        status: 'alive' as const,
        lastBeatAt: '2026-11-15T10:00:00.000Z',
        secondsAgo: 12,
      };
      jest.spyOn(service, 'checkWorkerHeartbeat').mockResolvedValue(alive);

      await expect(controller.getReadiness()).resolves.toEqual({
        status: 'ready',
        postgres: 'ok',
        redis: 'ok',
        worker: alive,
        schedules: { status: 'ok', missing: [] },
      });
    });

    it('reports Redis as unreachable rather than hanging', async () => {
      process.env.REDIS_PORT = '9999';
      const { service } = build();
      const result = await service.checkWorkerHeartbeat(300);
      expect(result.status).toBe('unreachable');
    });
  });

  describe('round trip through a real Redis', () => {
    let available = false;
    beforeAll(async () => {
      available = await redisReachable();
    });

    it('a heartbeat written by the worker is read back as alive, and missing once gone', async () => {
      if (!available) return; // CI always has Redis; local runs may not.
      const heartbeat = new WorkerHeartbeatService();
      const service = new HealthService({} as PrismaService);
      try {
        expect(await heartbeat.beat()).toBe(true);
        const ttl = await heartbeat.getClient().ttl(WORKER_HEARTBEAT_KEY);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(WORKER_HEARTBEAT_TTL_SECONDS);

        const alive = await service.checkWorkerHeartbeat(2000);
        expect(alive.status).toBe('alive');
        expect(alive.secondsAgo).toBeLessThan(5);

        await heartbeat.getClient().del(WORKER_HEARTBEAT_KEY);
        const missing = await service.checkWorkerHeartbeat(2000);
        expect(missing.status).toBe('missing');
      } finally {
        await heartbeat.onModuleDestroy();
      }
    });
  });
});
