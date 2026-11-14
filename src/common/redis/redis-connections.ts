import { Logger } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { processRole } from '../process/process-role';

/**
 * Every Redis connection the app opens is made here, so one process keeps a
 * small, fixed number of them.
 *
 * Why: the free Render Key Value accepts about 50 connections. Render deploys
 * without downtime, so for a few minutes the old instance and the new one run
 * side by side, and both must fit. Before this file each BullMQ queue, worker,
 * the schedule keeper, the heartbeat and every readiness check opened their own
 * connections: 46 in one PROCESS_ROLE=all process, so a second instance could
 * not connect and the deploy timed out.
 *
 * Now a process opens:
 *   - ONE shared connection for everything that does not block: every BullMQ
 *     Queue (producers and job schedulers), the schedule keeper, the worker
 *     heartbeat, /health/ready and the CEO system status;
 *   - plus ONE blocking connection for the single BullMQ Worker (processes
 *     that run jobs: PROCESS_ROLE=worker or all). BullMQ makes it by calling
 *     `duplicate()` on the shared connection, which is counted here too
 *     (Redis lists it under BullMQ's name, `bull:<queue in base64>`).
 * So: web = 1, worker = 2, all = 2. REDIS_CONNECTION_BUDGET (default 12) is the
 * ceiling; going over it logs an error (it never stops the app).
 * `redis-connection-budget.spec.ts` boots the whole app for each role and fails
 * when a change opens more.
 *
 * Every connection reconnects by itself with backoff after ECONNRESET,
 * "Connection is closed" or "max number of clients reached", and never gives up
 * (unless REDIS_MAX_RETRIES is set, which only tests do).
 */
const logger = new Logger('RedisConnections');

/** Every setting read in this file (listed by name, so setting-names.spec.ts sees them). */
export const REDIS_SETTINGS = [
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_TLS',
  'REDIS_CONNECT_TIMEOUT_MS',
  'REDIS_MAX_RETRIES',
  'REDIS_RETRY_MAX_DELAY_MS',
  'REDIS_CONNECTION_BUDGET',
] as const;

export const DEFAULT_REDIS_CONNECTION_BUDGET = 12;
const DEFAULT_RETRY_MAX_DELAY_MS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/** What a connection is for; shows in `CLIENT LIST` as part of its name. */
export type RedisPurpose = 'shared' | 'blocking' | string;

/** The most connections one process may hold (REDIS_CONNECTION_BUDGET, default 12). */
export function redisConnectionBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.REDIS_CONNECTION_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_REDIS_CONNECTION_BUDGET;
}

/**
 * How long to wait before reconnect attempt `times` (1, 2, 3, ...): doubles from
 * half a second up to REDIS_RETRY_MAX_DELAY_MS (default 10 s), with a little
 * jitter so two instances do not knock at the same moment. Returns null (stop)
 * only after REDIS_MAX_RETRIES attempts, when that is set.
 */
export function redisRetryDelay(times: number, env: NodeJS.ProcessEnv = process.env, random: () => number = Math.random): number | null {
  if (env.REDIS_MAX_RETRIES !== undefined && env.REDIS_MAX_RETRIES !== '' && times > Number(env.REDIS_MAX_RETRIES)) {
    return null;
  }
  const max = Number(env.REDIS_RETRY_MAX_DELAY_MS) || DEFAULT_RETRY_MAX_DELAY_MS;
  const base = Math.min(max, 500 * 2 ** Math.min(Math.max(times - 1, 0), 10));
  return Math.round(base + random() * Math.min(250, base / 4));
}

/**
 * ioredis settings for every connection. `maxRetriesPerRequest: null` is what
 * BullMQ requires for a Worker (and accepts for a Queue); callers that must not
 * wait (health checks, HTTP paths) check `isRedisReady` or use a timeout.
 */
export function redisConnectionOptions(env: NodeJS.ProcessEnv = process.env): RedisOptions {
  return {
    host: env.REDIS_HOST || 'localhost',
    port: Number(env.REDIS_PORT) || 6379,
    password: env.REDIS_PASSWORD || undefined,
    tls: env.REDIS_TLS === 'true' ? {} : undefined,
    connectTimeout: Number(env.REDIS_CONNECT_TIMEOUT_MS) || DEFAULT_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    retryStrategy: (times: number) => redisRetryDelay(times, env),
  };
}

function settingsKey(options: RedisOptions): string {
  return [options.host, options.port, options.tls ? 'tls' : 'plain', options.password ? 'auth' : 'noauth'].join('|');
}

interface ClientStats {
  /** Connections ever created in this process (constructions, including duplicates). */
  created: number;
  /** Connections created and not yet ended. */
  open: number;
  byPurpose: Record<string, number>;
}

const stats: ClientStats = { created: 0, open: 0, byPurpose: {} };
/** Every connection made here and not yet ended (closed all together at shutdown). */
const liveClients = new Set<Redis>();
let warnedOverBudget = false;

/** Counts of the connections this process has made (used by the budget test). */
export function redisClientStats(): ClientStats {
  return { created: stats.created, open: stats.open, byPurpose: { ...stats.byPurpose } };
}

/** Test helper: start counting from zero. */
export function resetRedisClientStats(): void {
  stats.created = 0;
  stats.open = 0;
  stats.byPurpose = {};
  warnedOverBudget = false;
}

/** The name a connection shows in Redis `CLIENT LIST`: laboura:<role>:<pid>:<purpose>. */
export function redisConnectionName(purpose: RedisPurpose): string {
  return `laboura:${processRole()}:${process.pid}:${purpose}`.replace(/\s+/g, '-');
}

function track(client: Redis, purpose: RedisPurpose): Redis {
  stats.created += 1;
  stats.open += 1;
  stats.byPurpose[purpose] = (stats.byPurpose[purpose] ?? 0) + 1;
  let ended = false;
  liveClients.add(client);
  client.once('end', () => {
    liveClients.delete(client);
    if (ended) return;
    ended = true;
    stats.open = Math.max(0, stats.open - 1);
  });
  const budget = redisConnectionBudget();
  if (stats.open > budget && !warnedOverBudget) {
    warnedOverBudget = true;
    logger.error(
      `This process now holds ${stats.open} Redis connections, over the budget of ${budget} (REDIS_CONNECTION_BUDGET). ` +
        'Use the shared connection (sharedRedis) instead of opening new ones; see src/common/redis/redis-connections.ts.',
    );
  }
  // BullMQ makes a Worker's blocking connection by duplicating the one it is
  // given: count those too (they keep our reconnect settings). The name BullMQ
  // gives the copy (bull:<queue>...) is kept: Queue.getWorkers() finds workers by it.
  const original = client.duplicate.bind(client);
  (client as unknown as { duplicate: (override?: Partial<RedisOptions>) => Redis }).duplicate = (override?: Partial<RedisOptions>) => {
    const copyPurpose = 'blocking';
    const copy = original({ connectionName: redisConnectionName(copyPurpose), ...override }) as Redis;
    copy.on('error', () => undefined);
    return track(copy, copyPurpose);
  };
  return client;
}

/**
 * The one way to open a Redis connection. Prefer `sharedRedis()`; open a new
 * one only for something that blocks (BullMQ does that itself for its Worker).
 */
export function createRedisClient(purpose: RedisPurpose, overrides: Partial<RedisOptions> = {}): Redis {
  const client = new Redis({ ...redisConnectionOptions(), connectionName: redisConnectionName(purpose), ...overrides });
  return track(client, purpose);
}

const shared = new Map<string, Redis>();

/**
 * The process-wide shared connection (created on first use). Errors are logged
 * once per outage; ioredis reconnects by itself.
 */
export function sharedRedis(): Redis {
  const key = settingsKey(redisConnectionOptions());
  const existing = shared.get(key);
  if (existing && existing.status !== 'end') return existing;
  const client = createRedisClient('shared');
  let down = false;
  client.on('error', (error: Error) => {
    if (down) return;
    down = true;
    logger.warn(`Redis connection problem (${error.message}); reconnecting in the background`);
  });
  client.on('ready', () => {
    if (down) logger.log('Redis connection is back');
    down = false;
  });
  shared.set(key, client);
  return client;
}

/** True when the connection can take commands now. A stand-in without `status` (tests) counts as ready. */
export function isRedisReady(client: Pick<Redis, 'status'> | { status?: string }): boolean {
  return client.status === undefined || client.status === 'ready';
}

/**
 * Resolves once the connection is ready, or rejects after `timeoutMs`. Used so
 * checks never queue commands on a connection that is down (they would pile up
 * and run late, when it comes back).
 */
export function whenRedisReady(client: Redis | { status?: string }, timeoutMs: number): Promise<void> {
  if (isRedisReady(client)) return Promise.resolve();
  const redis = client as Redis;
  return new Promise<void>((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      redis.removeListener('ready', onReady);
      reject(new Error(`Redis not connected (status: ${redis.status}) after ${timeoutMs}ms`));
    }, timeoutMs);
    redis.once('ready', onReady);
  });
}

/** PING over the shared connection, within `timeoutMs`. Opens no new connection. */
export async function pingRedis(timeoutMs: number, client: Redis = sharedRedis()): Promise<void> {
  await whenRedisReady(client, timeoutMs);
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis did not answer within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Closes a connection politely (QUIT), and drops it after `timeoutMs` if Redis does not answer. */
export async function closeRedisClient(client: Redis, timeoutMs = 2000): Promise<void> {
  // Once closed, a connection stays closed: BullMQ calls connect() again on a
  // closed connection when a job still running at shutdown fails, which would
  // quietly reopen it (and keep the old instance's connection during a deploy).
  // The next sharedRedis() call makes a fresh connection instead.
  (client as unknown as { connect: () => Promise<void> }).connect = () =>
    Promise.reject(new Error('Redis connection was closed at shutdown'));
  if (client.status === 'end') return;
  let timer: NodeJS.Timeout | undefined;
  try {
    if (client.status !== 'ready') {
      client.disconnect();
      return;
    }
    await Promise.race([
      client.quit().then(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // fall through to disconnect
  } finally {
    if (timer) clearTimeout(timer);
    if ((client.status as string) !== 'end') client.disconnect();
  }
}

/**
 * Closes every connection this process made: the shared one and the copies
 * BullMQ made from it (the Worker's blocking connection). Used at shutdown, so
 * the old instance frees its connections at once during a deploy, and so a
 * connection still retrying (Redis down) stops instead of keeping the process
 * alive.
 */
export async function closeSharedRedis(timeoutMs = 2000): Promise<void> {
  const clients = new Set<Redis>([...shared.values(), ...liveClients]);
  shared.clear();
  liveClients.clear();
  await Promise.all([...clients].map((client) => closeRedisClient(client, timeoutMs)));
}
