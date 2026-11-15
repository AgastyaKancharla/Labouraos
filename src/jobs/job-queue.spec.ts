import { Logger } from '@nestjs/common';
import { DelayedError, Job, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import {
  JobQueue,
  LABOURA_JOBS_QUEUE,
  LABOURA_WORKER_NAME,
  UNKNOWN_JOB_MAX_RETRIES,
  UNKNOWN_JOB_RETRY_MS,
  jobQueue,
  startScheduledJob,
} from './job-queue';
import { closeSharedRedis } from '../common/redis/redis-connections';

const host = process.env.REDIS_HOST || 'localhost';
/** BullMQ names the Worker's blocking connection bull:<queue name in base64>:w:<worker name>. */
const WORKER_CONNECTION_PREFIX = `bull:${Buffer.from(LABOURA_JOBS_QUEUE).toString('base64')}:w:${LABOURA_WORKER_NAME}`;
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

function fakeJob(name: string, attemptsStarted = 1): Job & { moveToDelayed: jest.Mock } {
  return { name, id: `${name}-1`, data: {}, attemptsStarted, moveToDelayed: jest.fn().mockResolvedValue(undefined) } as unknown as Job & {
    moveToDelayed: jest.Mock;
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const originalRole = process.env.PROCESS_ROLE;
afterEach(() => {
  if (originalRole === undefined) delete process.env.PROCESS_ROLE;
  else process.env.PROCESS_ROLE = originalRole;
  jest.restoreAllMocks();
});

describe('JobQueue: one queue and one Worker for every job, dispatching by job name', () => {
  it('runs the handler registered under the job name', async () => {
    const queue = new JobQueue();
    const a = jest.fn().mockResolvedValue({ raised: 1 });
    const b = jest.fn().mockResolvedValue({ created: 2 });
    queue.register('daily-a', a);
    queue.register('daily-b', b);
    await expect(queue.dispatch(fakeJob('daily-b'), 'token')).resolves.toEqual({ created: 2 });
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('never runs two runs of the same job at once (as when each job had its own Worker), but runs different jobs side by side', async () => {
    const queue = new JobQueue();
    const events: string[] = [];
    const gates = [deferred(), deferred()];
    let call = 0;
    queue.register('sweep', async () => {
      const n = call++;
      events.push(`start-${n}`);
      await gates[n].promise;
      events.push(`end-${n}`);
    });
    queue.register('other', async () => {
      events.push('other');
    });

    const first = queue.dispatch(fakeJob('sweep'), 't1');
    const second = queue.dispatch(fakeJob('sweep'), 't2');
    await queue.dispatch(fakeJob('other'), 't3');
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(['start-0', 'other']);

    gates[0].resolve();
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(['start-0', 'other', 'end-0', 'start-1']);
    gates[1].resolve();
    await second;
  });

  it('a failed run does not block the next run of the same job, and its error reaches BullMQ (for retries)', async () => {
    const queue = new JobQueue();
    const handler = jest.fn().mockRejectedValueOnce(new Error('database went away')).mockResolvedValueOnce('ok');
    queue.register('sweep', handler);
    await expect(queue.dispatch(fakeJob('sweep'), 't1')).rejects.toThrow('database went away');
    await expect(queue.dispatch(fakeJob('sweep'), 't2')).resolves.toBe('ok');
  });

  it('puts back a job it has no handler for (a newer version added it during a deploy), and fails it in the end', async () => {
    const queue = new JobQueue();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const job = fakeJob('customer-push');
    const before = Date.now();
    await expect(queue.dispatch(job, 'token')).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token');
    expect(job.moveToDelayed.mock.calls[0][0]).toBeGreaterThanOrEqual(before + UNKNOWN_JOB_RETRY_MS);

    const tooOld = fakeJob('customer-push', UNKNOWN_JOB_MAX_RETRIES + 1);
    await expect(queue.dispatch(tooOld, 'token')).rejects.toThrow(/No handler for job 'customer-push'/);
    expect(tooOld.moveToDelayed).not.toHaveBeenCalled();
  });

  it('finishes a retired job (in RETIRED_JOBS) and removes its schedule instead of putting it back (L-7)', async () => {
    const queue = new JobQueue();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const removeJobScheduler = jest.fn().mockResolvedValue(true);
    jest.spyOn(queue, 'queue').mockReturnValue({ removeJobScheduler } as never);
    const job = fakeJob('probe-id-check-recovery');
    await expect(queue.dispatch(job, 'token')).resolves.toEqual({ retired: true });
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(removeJobScheduler).toHaveBeenCalledWith('kyc-recovery-scheduler');

    // Removing the schedule failing (Redis busy) still finishes the job.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    removeJobScheduler.mockRejectedValueOnce(new Error('busy'));
    await expect(queue.dispatch(fakeJob('probe-id-check-recovery'), 'token')).resolves.toEqual({ retired: true });
  });

  it('builds no Worker in a web process', () => {
    process.env.PROCESS_ROLE = 'web';
    const queue = new JobQueue();
    expect(() => queue.worker('sweep', jest.fn())).toThrow(/only be constructed in a worker process/);
    expect(() => queue.start()).toThrow(/only be constructed in a worker process/);
    expect(queue.isWorkerRunning()).toBe(false);
  });

  describe('startScheduledJob (what each job does at start-up)', () => {
    const savedTimeout = process.env.REDIS_STARTUP_TIMEOUT_MS;
    afterEach(() => {
      if (savedTimeout === undefined) delete process.env.REDIS_STARTUP_TIMEOUT_MS;
      else process.env.REDIS_STARTUP_TIMEOUT_MS = savedTimeout;
      jobQueue.release('spec-job');
    });

    it('registers the handler even when Redis refuses the schedule, so the job runs once Redis is back', async () => {
      const onError = jest.fn();
      const startWorker = jest.fn();
      await startScheduledJob({
        name: 'spec-job',
        handler: jest.fn(),
        schedule: () => Promise.reject(new Error('ECONNREFUSED')),
        startWorker,
        onError,
      });
      expect(jobQueue.hasHandler('spec-job')).toBe(true);
      expect(startWorker).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith('ECONNREFUSED');
    });

    it('never holds up start-up for longer than REDIS_STARTUP_TIMEOUT_MS when Redis does not answer', async () => {
      process.env.REDIS_STARTUP_TIMEOUT_MS = '100';
      const onError = jest.fn();
      const started = Date.now();
      await startScheduledJob({
        name: 'spec-job',
        handler: jest.fn(),
        schedule: () => new Promise<void>(() => undefined),
        startWorker: jest.fn(),
        onError,
      });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/timed out after 100ms/));
    });
  });

  describe('with a real Redis', () => {
    let available = false;
    let admin: Redis;
    let events: QueueEvents | undefined;
    const queue = new JobQueue();

    beforeAll(async () => {
      available = await redisReachable();
      if (!available) return;
      admin = new Redis({ host, port, connectionName: 'spec-admin' });
      admin.on('error', () => undefined);
      const keys = await admin.keys(`bull:${LABOURA_JOBS_QUEUE}:*`);
      if (keys.length) await admin.del(...keys);
    });

    afterAll(async () => {
      await events?.close();
      await queue.close(0);
      await closeSharedRedis(500);
      if (!available) return;
      const keys = await admin.keys(`bull:${LABOURA_JOBS_QUEUE}:*`);
      if (keys.length) await admin.del(...keys);
      admin.disconnect();
    });

    it('runs jobs of different names through the one Worker, and keeps working after Redis drops its connections', async () => {
      if (!available) return; // CI always has Redis; local runs may not.
      process.env.PROCESS_ROLE = 'all';
      const seen: string[] = [];
      queue.register('spec-a', async (job) => {
        seen.push(`a:${job.data.n}`);
        return { n: job.data.n };
      });
      queue.register('spec-b', async (job) => {
        seen.push(`b:${job.data.n}`);
        return { n: job.data.n };
      });
      const worker = queue.start();
      await worker.waitUntilReady();
      events = new QueueEvents(LABOURA_JOBS_QUEUE, { connection: { host, port } });
      await events.waitUntilReady();

      const first = await queue.add('spec-a', { n: 1 });
      const second = await queue.add('spec-b', { n: 2 });
      await expect(first.waitUntilFinished(events, 10_000)).resolves.toEqual({ n: 1 });
      await expect(second.waitUntilFinished(events, 10_000)).resolves.toEqual({ n: 2 });

      // Redis drops every connection of the app (ECONNRESET, "Connection is
      // closed"): the shared connection and the Worker reconnect by themselves.
      const list = (await admin.call('CLIENT', 'LIST')) as string;
      const ids = list
        .split('\n')
        .filter((line) => line.includes(`:${process.pid}:`) || line.includes(`name=${WORKER_CONNECTION_PREFIX}`))
        .map((line) => /id=(\d+)/.exec(line)?.[1])
        .filter(Boolean) as string[];
      expect(ids.length).toBe(2); // shared + the Worker's blocking connection
      for (const id of ids) await admin.call('CLIENT', 'KILL', 'ID', id);

      const third = await queue.add('spec-a', { n: 3 });
      await expect(third.waitUntilFinished(events, 20_000)).resolves.toEqual({ n: 3 });
      expect(seen).toEqual(['a:1', 'b:2', 'a:3']);
    }, 40_000);
  });
});
