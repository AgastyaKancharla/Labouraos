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
import { AppModule } from '../app.module';

describe('Phase 6.5 Task 3: Separate Worker Entrypoint & Worker Lifecycle', () => {
  const originalProcessRole = process.env.PROCESS_ROLE;
  let mockPrisma: Partial<PrismaService>;
  let mockJobSeekerService: Partial<JobSeekerService>;

  beforeEach(() => {
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

  describe('3. Graceful Shutdown on Render SIGTERM (BullMQ close(false))', () => {
    it('close(false) waits for an active job to finish before resolving', async () => {
      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      let jobFinished = false;
      let resolveJobPromise: () => void = () => {};
      const jobExecutionPromise = new Promise<void>((resolve) => {
        resolveJobPromise = () => {
          jobFinished = true;
          resolve();
        };
      });

      // Mock BullMQ Worker implementing close(force) behavior:
      // When force === false, it awaits in-flight jobs.
      const mockWorker = {
        close: jest.fn().mockImplementation(async (force = false) => {
          if (!force) {
            await jobExecutionPromise;
          }
        }),
      } as unknown as Worker;

      // Assign worker to job
      (job as unknown as { worker: Worker }).worker = mockWorker;
      expect(job.hasWorker()).toBe(true);

      // Trigger graceful close
      let closeResolved = false;
      const closePromise = job.close(false).then(() => {
        closeResolved = true;
      });

      // Advance event loop slightly; close should NOT have resolved yet because job is still running
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closeResolved).toBe(false);
      expect(jobFinished).toBe(false);

      // Now complete the active sweep job
      resolveJobPromise();
      await closePromise;

      // Now close has resolved and active job finished
      expect(jobFinished).toBe(true);
      expect(closeResolved).toBe(true);
      expect(mockWorker.close).toHaveBeenCalledWith(false);
      expect(job.hasWorker()).toBe(false);
    });

    it('onModuleDestroy calls close(false) ensuring NestJS shutdown awaits active sweep', async () => {
      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      const closeSpy = jest.spyOn(job, 'close').mockResolvedValue(undefined);

      await job.onModuleDestroy();

      expect(closeSpy).toHaveBeenCalledWith(false);
    });

    it('close(true) forces immediate shutdown without waiting for jobs', async () => {
      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      let jobFinished = false;
      const mockWorker = {
        close: jest.fn().mockImplementation(async (force = false) => {
          if (!force) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            jobFinished = true;
          }
          // force=true resolves immediately without waiting
        }),
      } as unknown as Worker;

      (job as unknown as { worker: Worker }).worker = mockWorker;

      await job.close(true);

      expect(mockWorker.close).toHaveBeenCalledWith(true);
      expect(jobFinished).toBe(false); // Did not wait for the job
      expect(job.hasWorker()).toBe(false);
    });
  });
});
