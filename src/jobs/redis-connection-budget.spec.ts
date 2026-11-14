import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import {
  redisClientStats,
  redisConnectionBudget,
  resetRedisClientStats,
} from '../common/redis/redis-connections';
import { ProcessRole } from '../common/process/process-role';
import { jobQueue, LABOURA_JOBS_QUEUE } from './job-queue';
import { JobScheduleKeeper } from './job-schedule-keeper.service';

/**
 * The Redis connection budget, measured on the whole app.
 *
 * The free Render Key Value accepts about 50 connections, and a deploy runs
 * the old and the new instance side by side for a few minutes. Before the
 * shared connection, one PROCESS_ROLE=all process held 46, so deploys timed
 * out. This boots the app for each PROCESS_ROLE, uses Redis the way the site
 * does (readiness checks, a manual job run), and counts the connections both
 * ways: the constructions the factory saw, and the clients Redis itself lists.
 *
 * If this fails after adding something: use the shared connection
 * (sharedRedis) and the shared job queue (jobQueue), never a new connection —
 * AGENTS.md, "Background jobs".
 */
const host = process.env.REDIS_HOST || 'localhost';
const port = Number(process.env.REDIS_PORT) || 6379;

/** What each kind of process opens: one shared connection, plus one blocking connection for the job Worker. */
const EXPECTED: Record<ProcessRole, number> = { web: 1, worker: 2, all: 2 };

async function redisReachable(): Promise<boolean> {
  const client = new Redis({ host, port, lazyConnect: true, connectTimeout: 300, maxRetriesPerRequest: 0, retryStrategy: () => null });
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

async function waitFor(check: () => Promise<boolean>, ms = 10_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function boot(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('Redis connection budget per PROCESS_ROLE (whole app)', () => {
  const saved = {
    PROCESS_ROLE: process.env.PROCESS_ROLE,
    WORKER_HEARTBEAT_CHECK: process.env.WORKER_HEARTBEAT_CHECK,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_STARTUP_TIMEOUT_MS: process.env.REDIS_STARTUP_TIMEOUT_MS,
  };
  let available = false;
  let admin: Redis;

  beforeAll(async () => {
    available = await redisReachable();
    if (available) {
      admin = new Redis({ host, port, connectionName: 'spec-admin' });
      admin.on('error', () => undefined);
    }
  });

  afterAll(() => {
    restoreEnv(saved);
    admin?.disconnect();
  });

  afterEach(() => {
    restoreEnv(saved);
    jest.restoreAllMocks();
  });

  /** Connections Redis lists for this process (names are laboura:<role>:<pid>:<purpose>). */
  async function listed(): Promise<string[]> {
    const list = (await admin.call('CLIENT', 'LIST')) as string;
    return list
      .split('\n')
      .map((line) => /name=(\S+)/.exec(line)?.[1] ?? '')
      .filter((name) => name.startsWith('laboura:') && name.includes(`:${process.pid}:`));
  }

  it.each(['web', 'worker', 'all'] as ProcessRole[])(
    'PROCESS_ROLE=%s stays within the budget, and two instances fit in a free Key Value during a deploy',
    async (role) => {
      if (!available) {
        console.warn('Redis not reachable; skipping the connection budget test');
        return;
      }
      process.env.PROCESS_ROLE = role;
      process.env.WORKER_HEARTBEAT_CHECK = 'true';
      resetRedisClientStats();
      const app = await boot();
      try {
        // Use Redis the way the site does: the readiness checks (several at
        // once, as monitors do), the CEO's schedule view and a manual run.
        await Promise.all([1, 2, 3, 4, 5].map(() => request(app.getHttpServer()).get('/health/ready')));
        await app.get(JobScheduleKeeper).status();
        await jobQueue.queue().getJobCounts();
        if (role !== 'web') {
          await jobQueue.start().waitUntilReady();
        }

        const expected = EXPECTED[role];
        expect(await waitFor(async () => (await listed()).length === expected)).toBe(true);
        const names = await listed();
        const stats = redisClientStats();

        expect({ role, listed: names.length, created: stats.created }).toEqual({ role, listed: expected, created: expected });
        expect(stats.created).toBeLessThanOrEqual(redisConnectionBudget());
        // Old and new instance side by side, well under the free plan's ~50.
        expect(2 * stats.created).toBeLessThan(50);
        expect(names.filter((n) => n.endsWith(':shared'))).toHaveLength(1);
        if (role !== 'web') expect(names.filter((n) => n.endsWith(':blocking'))).toHaveLength(1);
      } finally {
        await app.close();
      }
      // Shutdown gives every connection back at once (the old instance during a deploy).
      expect(await waitFor(async () => (await listed()).length === 0, 5000)).toBe(true);
    },
    60_000,
  );
});

describe('Starting with Redis unreachable (Key Value full or down during a deploy)', () => {
  const saved = {
    PROCESS_ROLE: process.env.PROCESS_ROLE,
    WORKER_HEARTBEAT_CHECK: process.env.WORKER_HEARTBEAT_CHECK,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_STARTUP_TIMEOUT_MS: process.env.REDIS_STARTUP_TIMEOUT_MS,
  };

  afterEach(() => {
    restoreEnv(saved);
    jest.restoreAllMocks();
  });

  it('PROCESS_ROLE=all still starts and serves HTTP: /health answers 200 and /health/ready names the problem', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    process.env.PROCESS_ROLE = 'all';
    process.env.WORKER_HEARTBEAT_CHECK = 'true';
    process.env.REDIS_PORT = '1'; // nothing listens there: connection refused, like a full Key Value
    process.env.REDIS_STARTUP_TIMEOUT_MS = '500';

    const started = Date.now();
    const app = await boot();
    try {
      expect(Date.now() - started).toBeLessThan(20_000);

      const live = await request(app.getHttpServer()).get('/health');
      expect(live.status).toBe(200);
      expect(live.body.status).toBe('ok');

      const ready = await request(app.getHttpServer()).get('/health/ready');
      expect(ready.status).toBe(503);
      expect(ready.body.failed).toEqual(expect.arrayContaining(['redis']));

      // The job worker is up and every handler is registered: jobs run as soon as Redis answers.
      expect(jobQueue.isWorkerRunning()).toBe(true);
      expect(jobQueue.handlerNames()).toEqual(expect.arrayContaining(['daily-no-pickup-evaluation', 'copy-recording']));
    } finally {
      const closing = Date.now();
      await app.close();
      // Shutdown does not hang on a Redis that does not answer.
      expect(Date.now() - closing).toBeLessThan(15_000);
    }
  }, 60_000);

  it('uses the one shared queue name for every job', () => {
    expect(LABOURA_JOBS_QUEUE).toBe('laboura-jobs');
  });
});
