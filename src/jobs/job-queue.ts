import { Logger } from '@nestjs/common';
import { DelayedError, Job, JobsOptions, Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { isRedisReady, sharedRedis } from '../common/redis/redis-connections';
import { runsJobs } from '../common/process/process-role';
import { RETIRED_JOBS } from './job-catalog';

/**
 * The ONE BullMQ queue every background job uses, and the ONE Worker that runs
 * them, dispatching by job name.
 *
 * Before, each job had its own queue and its own Worker (3 Redis connections
 * per job). Now:
 *   - every job schedule (`upsertJobScheduler`) and every one-off job
 *     (`queue().add(name, ...)`) goes into this queue, under the job's name;
 *   - one Worker (in PROCESS_ROLE=worker or all) takes each job and calls the
 *     handler registered under that name;
 *   - two runs of the same job never overlap in one process (as when each job
 *     had a Worker with concurrency 1); different jobs still run side by side,
 *     up to JOB_WORKER_CONCURRENCY (default 16) at once.
 * The queue uses the shared Redis connection; the Worker adds one blocking
 * connection. Adding a job never adds a connection.
 *
 * How to add a job: AGENTS.md, "Background jobs".
 */
export const LABOURA_JOBS_QUEUE = 'laboura-jobs';
/** The Worker's name: Redis lists its blocking connection as bull:<queue in base64>:w:laboura. */
export const LABOURA_WORKER_NAME = 'laboura';

export type JobHandler = (job: Job) => Promise<unknown>;

const DEFAULT_CONCURRENCY = 16;
const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;
/** A job this process has no handler for is put back for this long (another instance may have one). */
export const UNKNOWN_JOB_RETRY_MS = 30_000;
/** ...at most this many times, then it fails (its name is no longer used anywhere). */
export const UNKNOWN_JOB_MAX_RETRIES = 20;
const CLOSE_STEP_TIMEOUT_MS = 3000;

export function jobWorkerConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.JOB_WORKER_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_CONCURRENCY;
}

/** How long shutdown waits for running jobs before stopping them (JOB_SHUTDOWN_GRACE_MS, default 10 s). */
export function jobShutdownGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.JOB_SHUTDOWN_GRACE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SHUTDOWN_GRACE_MS;
}

/** Resolves true when `work` settles within `ms`, false otherwise. Never rejects. */
function settlesWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function redisUpForQueue(client: Redis | null): boolean {
  return client ? isRedisReady(client) : true;
}

export class JobQueue {
  private readonly logger = new Logger('JobQueue');
  private readonly handlers = new Map<string, JobHandler>();
  /** The run in progress (or queued in this process) for each job name. */
  private readonly running = new Map<string, Promise<void>>();
  private queueInstance: Queue | null = null;
  private workerInstance: Worker | null = null;
  /** The shared connection the queue and worker were built on (a new one after a shutdown, or in tests). */
  private queueClient: Redis | null = null;
  private workerClient: Redis | null = null;

  /** Registers what runs for jobs named `name`. Touches no Redis. */
  register(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  /** Stops handling jobs named `name` in this process (the shared Worker keeps running). */
  release(name: string): void {
    this.handlers.delete(name);
  }

  handlerNames(): string[] {
    return [...this.handlers.keys()].sort();
  }

  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /** The shared queue (built on first use, on the shared connection). Web processes use it to enqueue. */
  queue(): Queue {
    const client = sharedRedis();
    if (this.queueInstance && this.queueClient !== client) {
      void settlesWithin(this.queueInstance.close(), CLOSE_STEP_TIMEOUT_MS);
      this.queueInstance = null;
    }
    if (!this.queueInstance) {
      this.queueInstance = new Queue(LABOURA_JOBS_QUEUE, { connection: client });
      this.queueInstance.on('error', (error) => this.logger.warn(`Job queue error: ${error.message}`));
      this.queueClient = client;
    }
    return this.queueInstance;
  }

  /** Adds a one-off run of job `name`. */
  add(name: string, data: unknown, opts?: JobsOptions): Promise<Job> {
    return this.queue().add(name, data, opts);
  }

  /**
   * Registers `handler` for jobs named `name` and makes sure the one Worker is
   * running. Returns that Worker. Only in a process that runs jobs.
   */
  worker(name: string, handler: JobHandler): Worker {
    this.assertRunsJobs();
    this.register(name, handler);
    return this.start();
  }

  /**
   * Starts the one Worker if it is not running. Never waits for Redis: BullMQ
   * connects (and reconnects) in the background.
   */
  start(): Worker {
    this.assertRunsJobs();
    const client = sharedRedis();
    if (this.workerInstance && this.workerClient !== client) {
      const stale = this.workerInstance;
      void settlesWithin(stale.close(true), CLOSE_STEP_TIMEOUT_MS);
      this.workerInstance = null;
    }
    if (!this.workerInstance) {
      const worker = new Worker(LABOURA_JOBS_QUEUE, (job, token) => this.dispatch(job, token), {
        connection: client,
        concurrency: jobWorkerConcurrency(),
        name: LABOURA_WORKER_NAME,
      });
      this.workerClient = client;
      let lastError = '';
      worker.on('error', (error) => {
        // During a Redis outage BullMQ reports the same error on every retry.
        if (error.message === lastError) return;
        lastError = error.message;
        this.logger.error(`Job worker error: ${error.message}`);
      });
      worker.on('ready', () => {
        lastError = '';
      });
      this.workerInstance = worker;
    }
    return this.workerInstance;
  }

  isWorkerRunning(): boolean {
    return this.workerInstance !== null;
  }

  /** Runs one job: the handler registered under its name, one run per name at a time. */
  async dispatch(job: Job, token?: string): Promise<unknown> {
    const handler = this.handlers.get(job.name);
    const retired = handler ? undefined : RETIRED_JOBS.find((entry) => entry.jobName === job.name);
    if (retired) {
      // A job that no longer exists (Fable final re-check, L-7): done, and its schedule removed —
      // never put back for an instance that will never come.
      this.logger.log(`Job '${job.name}' is retired: finished without running, its schedule removed`);
      try {
        await this.queue().removeJobScheduler(retired.schedulerId);
      } catch (error) {
        this.logger.warn(`Could not remove the retired schedule '${retired.schedulerId}': ${(error as Error).message}`);
      }
      return { retired: true };
    }
    if (!handler) {
      // Usually a job added by a newer version during a deploy (both run for a
      // few minutes). Put it back so the instance that knows it runs it.
      if (token && (job.attemptsStarted ?? 0) <= UNKNOWN_JOB_MAX_RETRIES) {
        this.logger.warn(`No handler for job '${job.name}' in this process; trying again in ${UNKNOWN_JOB_RETRY_MS / 1000}s`);
        await job.moveToDelayed(Date.now() + UNKNOWN_JOB_RETRY_MS, token);
        throw new DelayedError();
      }
      throw new Error(`No handler for job '${job.name}' (known: ${this.handlerNames().join(', ') || 'none'})`);
    }
    const previous = this.running.get(job.name) ?? Promise.resolve();
    const run = previous.then(() => handler(job));
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.running.set(job.name, settled);
    void settled.then(() => {
      if (this.running.get(job.name) === settled) this.running.delete(job.name);
    });
    return run;
  }

  /**
   * Stops the Worker: waits up to `graceMs` for running jobs, then stops them
   * (BullMQ hands an interrupted job to the next worker). Never hangs, even when
   * Redis is unreachable.
   */
  async close(graceMs: number = jobShutdownGraceMs()): Promise<void> {
    const worker = this.workerInstance;
    const queue = this.queueInstance;
    this.workerInstance = null;
    this.queueInstance = null;
    if (worker) {
      const redisUp = this.workerClient ? isRedisReady(this.workerClient) : true;
      if (redisUp) {
        const finished = await settlesWithin(worker.close(false), graceMs);
        if (!finished) {
          // closeSharedRedis (next, at shutdown) drops the connections; BullMQ's
          // stalled-job check hands the interrupted job to the next worker.
          this.logger.warn(`Background jobs still running after ${graceMs}ms; stopping the job worker now`);
        }
      } else {
        // With Redis down no job can finish (BullMQ records results in Redis)
        // and a graceful close would wait for ever: stop at once.
        await settlesWithin(worker.close(true), 500);
      }
    }
    if (queue) await settlesWithin(queue.close(), redisUpForQueue(this.queueClient) ? CLOSE_STEP_TIMEOUT_MS : 500);
  }

  private assertRunsJobs(): void {
    if (!runsJobs()) {
      throw new Error('BullMQ Worker can only be constructed in a worker process (PROCESS_ROLE === "worker")');
    }
  }
}

/** One per process, like the shared Redis connection it uses. */
export const jobQueue = new JobQueue();

/** How long a job waits for Redis at start-up before carrying on without it (REDIS_STARTUP_TIMEOUT_MS, default 2 s). */
export function redisStartupTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.REDIS_STARTUP_TIMEOUT_MS) || 2000;
}

export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export interface ScheduledJobStart {
  /** The BullMQ job name (unique; the shared worker dispatches on it). */
  name: string;
  handler: JobHandler;
  /** Writes the job's schedule (upsertJobScheduler on the shared queue). */
  schedule: () => Promise<void>;
  /** Makes sure the shared worker runs (the job's getWorker()). */
  startWorker: () => unknown;
  onError: (message: string) => void;
}

/**
 * What every scheduled job does when a process that runs jobs starts:
 *   1. registers its handler — no Redis needed, so the job runs as soon as
 *      Redis is reachable, even if it was down at start;
 *   2. tries, for REDIS_STARTUP_TIMEOUT_MS at most, to write its schedule and
 *      start the shared worker.
 * It never fails or holds up start-up: when Redis is down the app still starts
 * and serves HTTP, JobQueueLifecycle starts the worker anyway (BullMQ connects
 * in the background) and JobScheduleKeeper writes the schedules once Redis
 * answers.
 */
export async function startScheduledJob(job: ScheduledJobStart): Promise<void> {
  jobQueue.register(job.name, job.handler);
  try {
    await withTimeout(job.schedule(), redisStartupTimeoutMs(), 'Registering the job schedule');
    job.startWorker();
  } catch (error: unknown) {
    job.onError(error instanceof Error ? error.message : String(error));
  }
}
