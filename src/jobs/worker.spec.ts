import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import {
  NoPickupEvaluationJob,
  NO_PICKUP_EVALUATION_JOB,
} from './no-pickup-evaluation.job';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobSeekerService } from '../modules/job-seeker/job-seeker.service';
import { bootstrapWorker } from '../worker';
import { JobQueue, jobQueue } from './job-queue';
import { AppModule } from '../app.module';

describe('Phase 6.5 Task 3: Separate Worker Entrypoint & Worker Lifecycle', () => {
  const originalProcessRole = process.env.PROCESS_ROLE;
  let mockPrisma: Partial<PrismaService>;
  let mockJobSeekerService: Partial<JobSeekerService>;

  beforeEach(() => {
    process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
    mockPrisma = {
      jobSeeker: { findMany: jest.fn() },
      contactAttempt: { findMany: jest.fn(), create: jest.fn() },
      staff: { findFirst: jest.fn() },
    } as unknown as Partial<PrismaService>;

    mockJobSeekerService = {
      recordHit: jest.fn(),
    } as unknown as Partial<JobSeekerService>;
  });

  afterEach(() => {
    if (originalProcessRole === undefined) {
      delete process.env.PROCESS_ROLE;
    } else {
      process.env.PROCESS_ROLE = originalProcessRole;
    }
    jest.restoreAllMocks();
  });

  describe('1. PROCESS_ROLE Gating & Worker Construction Count', () => {
    it('constructs exactly one BullMQ Worker when PROCESS_ROLE is "worker"', async () => {
      process.env.PROCESS_ROLE = 'worker';

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      const mockWorker = {
        close: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      } as unknown as Worker;

      const mockQueue = {
        upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      } as unknown as Queue;

      const getWorkerSpy = jest.spyOn(job, 'getWorker').mockReturnValue(mockWorker);
      const getQueueSpy = jest.spyOn(job, 'getQueue').mockReturnValue(mockQueue);

      await job.onModuleInit();

      // Exactly one Worker is constructed
      expect(getWorkerSpy).toHaveBeenCalledTimes(1);
      expect(getQueueSpy).toHaveBeenCalled();

      await job.close(true);
    });

    it('constructs zero BullMQ Worker instances when PROCESS_ROLE is unset (HTTP process)', async () => {
      delete process.env.PROCESS_ROLE;

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      const getWorkerSpy = jest.spyOn(job, 'getWorker');
      const getQueueSpy = jest.spyOn(job, 'getQueue');

      await job.onModuleInit();

      // Zero workers and zero schedulers/queues constructed
      expect(getWorkerSpy).not.toHaveBeenCalled();
      expect(getQueueSpy).not.toHaveBeenCalled();
      expect(job.hasWorker()).toBe(false);
      expect(job.hasQueue()).toBe(false);

      await job.close(true);
    });

    it('constructs zero BullMQ Worker instances when PROCESS_ROLE is "web"', async () => {
      process.env.PROCESS_ROLE = 'web';

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      const getWorkerSpy = jest.spyOn(job, 'getWorker');
      const getQueueSpy = jest.spyOn(job, 'getQueue');

      await job.onModuleInit();

      expect(getWorkerSpy).not.toHaveBeenCalled();
      expect(getQueueSpy).not.toHaveBeenCalled();
      expect(job.hasWorker()).toBe(false);
      expect(job.hasQueue()).toBe(false);

      await job.close(true);
    });

    it('throws when getWorker() is called directly and PROCESS_ROLE is not "worker"', () => {
      delete process.env.PROCESS_ROLE;

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      expect(() => job.getWorker()).toThrow(
        'BullMQ Worker can only be constructed in a worker process (PROCESS_ROLE === "worker")',
      );
    });

    it('allows HTTP process to construct Queue on demand for enqueueing while constructing zero Worker instances', async () => {
      delete process.env.PROCESS_ROLE;

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'enqueued-http-job-1' }),
        close: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      } as unknown as Queue;

      jest.spyOn(job, 'getQueue').mockReturnValue(mockQueue);
      const getWorkerSpy = jest.spyOn(job, 'getWorker');

      // Boot HTTP process (onModuleInit with PROCESS_ROLE unset)
      await job.onModuleInit();
      expect(job.hasWorker()).toBe(false);

      // Trigger a job from the manual trigger endpoint in the HTTP process
      const jobId = await job.triggerJob('http-req-test-123');

      expect(jobId).toBe('enqueued-http-job-1');
      expect(mockQueue.add).toHaveBeenCalledWith(NO_PICKUP_EVALUATION_JOB, {
        requestId: 'http-req-test-123',
      });

      // Still zero Worker instances constructed
      expect(getWorkerSpy).not.toHaveBeenCalled();
      expect(job.hasWorker()).toBe(false);

      await job.close(true);
    });
  });

  describe('2. Worker Entrypoint (src/worker.ts)', () => {
    it('bootstrapWorker sets PROCESS_ROLE="worker" and boots application context without HTTP listener', async () => {
      delete process.env.PROCESS_ROLE;

      const mockAppContext = {
        useLogger: jest.fn(),
        enableShutdownHooks: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      } as unknown as INestApplicationContext;

      const createAppContextSpy = jest
        .spyOn(NestFactory, 'createApplicationContext')
        .mockResolvedValue(mockAppContext);

      const app = await bootstrapWorker();

      // Confirms PROCESS_ROLE is set to worker
      expect(process.env.PROCESS_ROLE).toBe('worker');

      // Confirms createApplicationContext is used instead of create (no HTTP listener)
      expect(createAppContextSpy).toHaveBeenCalledWith(AppModule, {
        bufferLogs: true,
      });

      // Confirms shutdown hooks are enabled
      expect(mockAppContext.enableShutdownHooks).toHaveBeenCalledTimes(1);

      // Confirms the returned application context has no HTTP listener
      expect(
        (app as unknown as { getHttpServer?: () => unknown }).getHttpServer,
      ).toBeUndefined();
    });
  });

  // Every job shares one queue and one Worker now (job-queue.ts), so the
  // graceful close lives on the shared JobQueue: a job's own close() only stops
  // handling that job in this process.
  describe('3. Graceful Shutdown on Render SIGTERM (BullMQ close(false), then close(true))', () => {
    function queueWithWorker(worker: Partial<Worker>): JobQueue {
      const queue = new JobQueue();
      (queue as unknown as { workerInstance: Partial<Worker> }).workerInstance = worker;
      return queue;
    }

    it('close() waits for an active job to finish before resolving', async () => {
      let jobFinished = false;
      let resolveJobPromise: () => void = () => {};
      const jobExecutionPromise = new Promise<void>((resolve) => {
        resolveJobPromise = () => {
          jobFinished = true;
          resolve();
        };
      });
      const mockWorker = {
        close: jest.fn().mockImplementation(async (force = false) => {
          if (!force) await jobExecutionPromise;
        }),
      };
      const queue = queueWithWorker(mockWorker);
      expect(queue.isWorkerRunning()).toBe(true);

      let closeResolved = false;
      const closePromise = queue.close(5000).then(() => {
        closeResolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closeResolved).toBe(false);
      expect(jobFinished).toBe(false);

      resolveJobPromise();
      await closePromise;

      expect(jobFinished).toBe(true);
      expect(closeResolved).toBe(true);
      expect(mockWorker.close).toHaveBeenCalledWith(false);
      expect(mockWorker.close).not.toHaveBeenCalledWith(true);
      expect(queue.isWorkerRunning()).toBe(false);
    });

    it('stops waiting once the grace period is over (the connections are then closed at shutdown)', async () => {
      const mockWorker = {
        close: jest.fn().mockImplementation(async (force = false) => {
          if (!force) await new Promise(() => undefined); // a job that never ends
        }),
      };
      const queue = queueWithWorker(mockWorker);
      const started = Date.now();
      await queue.close(50);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(mockWorker.close).toHaveBeenCalledWith(false);
      expect(queue.isWorkerRunning()).toBe(false);
    });

    it('with Redis down, stops at once (close(true)) instead of waiting for ever', async () => {
      const mockWorker = { close: jest.fn().mockImplementation(() => new Promise(() => undefined)) };
      const queue = queueWithWorker(mockWorker);
      (queue as unknown as { workerClient: { status: string } }).workerClient = { status: 'reconnecting' };
      const started = Date.now();
      await queue.close(10_000);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(mockWorker.close).toHaveBeenCalledWith(true);
      expect(mockWorker.close).not.toHaveBeenCalledWith(false);
    });

    it('onModuleDestroy calls close(false) on the job', async () => {
      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      const closeSpy = jest.spyOn(job, 'close').mockResolvedValue(undefined);

      await job.onModuleDestroy();

      expect(closeSpy).toHaveBeenCalledWith(false);
    });

    it("a job's close() only stops handling that job; the shared worker keeps running for the others", async () => {
      process.env.PROCESS_ROLE = 'worker';
      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );
      const shared = { close: jest.fn().mockResolvedValue(undefined), on: jest.fn() } as unknown as Worker;
      jest.spyOn(jobQueue, 'start').mockReturnValue(shared);

      expect(job.getWorker()).toBe(shared);
      expect(job.hasWorker()).toBe(true);
      expect(jobQueue.hasHandler(NO_PICKUP_EVALUATION_JOB)).toBe(true);

      await job.close(true);

      expect(job.hasWorker()).toBe(false);
      expect(jobQueue.hasHandler(NO_PICKUP_EVALUATION_JOB)).toBe(false);
      expect(shared.close).not.toHaveBeenCalled();
    });
  });
});
