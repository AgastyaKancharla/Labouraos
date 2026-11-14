import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import {
  closeSharedRedis,
  createRedisClient,
  DEFAULT_REDIS_CONNECTION_BUDGET,
  pingRedis,
  redisClientStats,
  redisConnectionBudget,
  redisConnectionOptions,
  redisRetryDelay,
  resetRedisClientStats,
  sharedRedis,
  whenRedisReady,
} from './redis-connections';

const host = process.env.REDIS_HOST || 'localhost';
const port = Number(process.env.REDIS_PORT) || 6379;

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

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function waitFor(check: () => Promise<boolean> | boolean, ms = 8000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe('Redis connections: one shared connection, reconnects by itself, counted against a budget', () => {
  const saved = {
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_MAX_RETRIES: process.env.REDIS_MAX_RETRIES,
    REDIS_RETRY_MAX_DELAY_MS: process.env.REDIS_RETRY_MAX_DELAY_MS,
    REDIS_CONNECTION_BUDGET: process.env.REDIS_CONNECTION_BUDGET,
  };

  afterEach(async () => {
    restoreEnv(saved);
    jest.restoreAllMocks();
    await closeSharedRedis(500);
    resetRedisClientStats();
  });

  describe('settings', () => {
    it('follows BullMQ guidance: maxRetriesPerRequest null (Workers need it) and a ready check', () => {
      const options = redisConnectionOptions({ REDIS_HOST: 'kv', REDIS_PORT: '6380', REDIS_TLS: 'true' } as NodeJS.ProcessEnv);
      expect(options).toMatchObject({ host: 'kv', port: 6380, tls: {}, maxRetriesPerRequest: null, enableReadyCheck: true });
      expect(typeof options.retryStrategy).toBe('function');
    });

    it('reconnects with a growing, capped delay and never gives up (unless REDIS_MAX_RETRIES is set)', () => {
      const env = {} as NodeJS.ProcessEnv;
      const noJitter = () => 0;
      expect(redisRetryDelay(1, env, noJitter)).toBe(500);
      expect(redisRetryDelay(2, env, noJitter)).toBe(1000);
      expect(redisRetryDelay(3, env, noJitter)).toBe(2000);
      expect(redisRetryDelay(50, env, noJitter)).toBe(10_000);
      expect(redisRetryDelay(10_000, env, noJitter)).toBe(10_000);
      expect(redisRetryDelay(3, { REDIS_RETRY_MAX_DELAY_MS: '1500' } as NodeJS.ProcessEnv, noJitter)).toBe(1500);
      expect(redisRetryDelay(2, { REDIS_MAX_RETRIES: '1' } as NodeJS.ProcessEnv, noJitter)).toBeNull();
    });

    it('has a configurable budget, 12 by default', () => {
      expect(DEFAULT_REDIS_CONNECTION_BUDGET).toBe(12);
      expect(redisConnectionBudget({} as NodeJS.ProcessEnv)).toBe(12);
      expect(redisConnectionBudget({ REDIS_CONNECTION_BUDGET: '6' } as NodeJS.ProcessEnv)).toBe(6);
      expect(redisConnectionBudget({ REDIS_CONNECTION_BUDGET: 'lots' } as NodeJS.ProcessEnv)).toBe(12);
    });
  });

  describe('counting', () => {
    it('hands out one shared connection, however often it is asked for', () => {
      resetRedisClientStats();
      const first = sharedRedis();
      const second = sharedRedis();
      expect(second).toBe(first);
      expect(redisClientStats()).toMatchObject({ created: 1, byPurpose: { shared: 1 } });
    });

    it('counts the copies BullMQ makes with duplicate() (a Worker\'s blocking connection), and names them', () => {
      resetRedisClientStats();
      const client = createRedisClient('shared', { lazyConnect: true });
      const copy = client.duplicate({ connectionName: 'bull:abc' });
      expect(redisClientStats()).toMatchObject({ created: 2, byPurpose: { shared: 1, blocking: 1 } });
      // BullMQ's name is kept: Queue.getWorkers() finds workers by it.
      expect(copy.options.connectionName).toBe('bull:abc');
      expect(client.duplicate().options.connectionName).toMatch(/^laboura:[a-z]+:\d+:blocking$/);
      expect(copy.options.maxRetriesPerRequest).toBeNull();
      client.disconnect();
      copy.disconnect();
    });

    it('logs an error (and carries on) when a process goes over its budget', () => {
      resetRedisClientStats();
      process.env.REDIS_CONNECTION_BUDGET = '2';
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const clients = [1, 2, 3].map(() => createRedisClient('extra', { lazyConnect: true }));
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toMatch(/3 Redis connections, over the budget of 2/);
      clients.forEach((c) => c.disconnect());
    });

    it('no file outside the Redis and job-queue modules opens its own Redis connection, queue or worker', () => {
      // Every connection goes through redis-connections.ts; every queue and
      // worker through jobs/job-queue.ts (one shared queue, one Worker).
      // A new job registers a name and a handler there instead (AGENTS.md, "Background jobs").
      const root = path.resolve(__dirname, '../..');
      const allowed = new Set(['common/redis/redis-connections.ts', 'jobs/job-queue.ts', 'jobs/legacy-queues.ts']);
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'test-support') walk(full);
            continue;
          }
          if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
          const rel = path.relative(root, full).split(path.sep).join('/');
          if (allowed.has(rel)) continue;
          const src = fs.readFileSync(full, 'utf8');
          if (/new (Redis|IORedis|Queue|Worker|QueueEvents|FlowProducer)\(/.test(src)) offenders.push(rel);
        }
      };
      walk(root);
      expect(offenders).toEqual([]);
    });
  });

  describe('when Redis is unreachable', () => {
    it('reports it within the timeout instead of hanging or queueing commands', async () => {
      process.env.REDIS_PORT = '1';
      const started = Date.now();
      await expect(whenRedisReady(sharedRedis(), 200)).rejects.toThrow(/Redis not connected/);
      await expect(pingRedis(200)).rejects.toThrow(/Redis not connected/);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(sharedRedis().status).not.toBe('end'); // still trying to reconnect
    });
  });

  describe('with a real Redis', () => {
    let available = false;
    let admin: Redis;

    beforeAll(async () => {
      available = await redisReachable();
      if (available) {
        admin = new Redis({ host, port, connectionName: 'spec-admin' });
        admin.on('error', () => undefined);
      }
    });

    afterAll(() => admin?.disconnect());

    async function ourConnections(): Promise<string[]> {
      const list = (await admin.client('LIST')) as string;
      return list
        .split('\n')
        .map((line) => /name=(\S+)/.exec(line)?.[1] ?? '')
        .filter((name) => name.includes(`:${process.pid}:`));
    }

    it('reconnects by itself after the server drops the connection (ECONNRESET / "Connection is closed")', async () => {
      if (!available) return; // CI always has Redis; local runs may not.
      const client = sharedRedis();
      await pingRedis(3000);
      // Redis drops every connection of this process (like a Key Value restart or a reset).
      const killed = await admin.call('CLIENT', 'KILL', 'TYPE', 'normal', 'SKIPME', 'yes');
      expect(Number(killed)).toBeGreaterThanOrEqual(1);
      expect(await waitFor(() => client.status === 'ready')).toBe(true);
      await expect(pingRedis(3000)).resolves.toBeUndefined();
      expect(sharedRedis()).toBe(client); // the same connection, reconnected
    });

    it('frees the connection on shutdown, and nothing can quietly reopen it', async () => {
      if (!available) return;
      const client = sharedRedis();
      await pingRedis(3000);
      expect((await ourConnections()).filter((n) => n.endsWith(':shared'))).toHaveLength(1);
      await closeSharedRedis(1000);
      expect(await waitFor(async () => (await ourConnections()).length === 0, 3000)).toBe(true);
      // BullMQ reconnects a closed connection when a job that was still running fails.
      await expect(client.connect()).rejects.toThrow(/closed at shutdown/);
      expect((await ourConnections()).length).toBe(0);
      // The next user gets a fresh connection.
      expect(sharedRedis()).not.toBe(client);
    });
  });
});
