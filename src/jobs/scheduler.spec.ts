import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import {
  NoPickupEvaluationJob,
  NO_PICKUP_EVALUATION_JOB,
} from './no-pickup-evaluation.job';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobSeekerService } from '../modules/job-seeker/job-seeker.service';

async function isPortReachable(port: number, host = 'localhost'): Promise<boolean> {
  const client = new Redis({
    host,
    port,
    connectTimeout: 300,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
    client.disconnect();
    return true;
  } catch {
    client.disconnect();
    return false;
  }
}

describe('Phase 6.5 Task 1: Schedule No-Pickup Sweep Startup Registration', () => {
  const originalProcessRole = process.env.PROCESS_ROLE;
  const originalRedisPort = process.env.REDIS_PORT;
  const originalTimeoutMs = process.env.REDIS_STARTUP_TIMEOUT_MS;
  const originalConnectTimeout = process.env.REDIS_CONNECT_TIMEOUT_MS;
  const originalMaxRetries = process.env.REDIS_MAX_RETRIES;
  let mockPrisma: Partial<PrismaService>;
  let mockJobSeekerService: Partial<JobSeekerService>;
  let redisAvailable = false;

  beforeAll(async () => {
    const port = Number(process.env.REDIS_PORT) || 6379;
    const host = process.env.REDIS_HOST || 'localhost';
    redisAvailable = await isPortReachable(port, host);
  });

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

    if (originalRedisPort === undefined) {
      delete process.env.REDIS_PORT;
    } else {
      process.env.REDIS_PORT = originalRedisPort;
    }

    if (originalTimeoutMs === undefined) {
      delete process.env.REDIS_STARTUP_TIMEOUT_MS;
    } else {
      process.env.REDIS_STARTUP_TIMEOUT_MS = originalTimeoutMs;
    }

    if (originalConnectTimeout === undefined) {
      delete process.env.REDIS_CONNECT_TIMEOUT_MS;
    } else {
      process.env.REDIS_CONNECT_TIMEOUT_MS = originalConnectTimeout;
    }

    if (originalMaxRetries === undefined) {
      delete process.env.REDIS_MAX_RETRIES;
    } else {
      process.env.REDIS_MAX_RETRIES = originalMaxRetries;
    }

    jest.restoreAllMocks();
  });

  describe('1. Default Behaviour and PROCESS_ROLE Gating', () => {
    it('does not register a scheduler or construct a queue when PROCESS_ROLE is unset', async () => {
      delete process.env.PROCESS_ROLE;

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      const scheduleSpy = jest.spyOn(job, 'scheduleDailyJob');

      await job.onModuleInit();

      expect(scheduleSpy).not.toHaveBeenCalled();
      expect((job as unknown as { queue: Queue | null }).queue).toBeNull();

      await job.close(true);
    });

    it('does not register a scheduler when PROCESS_ROLE is not "worker" (e.g. "web")', async () => {
      process.env.PROCESS_ROLE = 'web';

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      const scheduleSpy = jest.spyOn(job, 'scheduleDailyJob');

      await job.onModuleInit();

      expect(scheduleSpy).not.toHaveBeenCalled();
      expect((job as unknown as { queue: Queue | null }).queue).toBeNull();

      await job.close(true);
    });
  });

  describe('2. Unreachable Redis Tolerance', () => {
    it('completes startup and logs a warning without crashing when Redis is unreachable', async () => {
      process.env.PROCESS_ROLE = 'worker';
      process.env.REDIS_PORT = '9999'; // unreachable port
      process.env.REDIS_MAX_RETRIES = '1';
      process.env.REDIS_CONNECT_TIMEOUT_MS = '200';
      process.env.REDIS_STARTUP_TIMEOUT_MS = '200'; // short timeout for test

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Must not throw error
      await expect(job.onModuleInit()).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Could not connect BullMQ queue to Redis:/),
      );

      await job.close(true);
    });
  });

  describe('3. Scheduler Registration & Idempotency', () => {
    it('registers scheduler with pattern 0 0 * * * when PROCESS_ROLE is worker', async () => {
      process.env.PROCESS_ROLE = 'worker';

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      if (redisAvailable) {
        try {
          await job.onModuleInit();

          const schedulers = await job.getJobSchedulers();
          const dailyScheduler = schedulers.find(
            (s) =>
              s.id === 'daily-no-pickup-evaluation-scheduler' ||
              s.name === NO_PICKUP_EVALUATION_JOB,
          );

          expect(dailyScheduler).toBeDefined();
          expect(dailyScheduler?.pattern).toBe('0 0 * * *');

          await job.removeJobScheduler('daily-no-pickup-evaluation-scheduler');
        } finally {
          await job.close(true);
        }
      } else {
        const mockQueue = {
          upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
          getJobSchedulers: jest.fn().mockResolvedValue([
            {
              id: 'daily-no-pickup-evaluation-scheduler',
              name: NO_PICKUP_EVALUATION_JOB,
              pattern: '0 0 * * *',
            },
          ]),
          removeJobScheduler: jest.fn().mockResolvedValue(true),
          close: jest.fn().mockResolvedValue(undefined),
        };
        jest.spyOn(job, 'getQueue').mockReturnValue(mockQueue as unknown as Queue);
        jest
          .spyOn(job, 'getWorker')
          .mockReturnValue({ close: jest.fn() } as unknown as Worker);

        await job.onModuleInit();

        expect(mockQueue.upsertJobScheduler).toHaveBeenCalledWith(
          'daily-no-pickup-evaluation-scheduler',
          { pattern: '0 0 * * *' },
          { name: NO_PICKUP_EVALUATION_JOB },
        );

        const schedulers = await job.getJobSchedulers();
        expect(schedulers[0].pattern).toBe('0 0 * * *');
        await job.close(true);
      }
    });

    it('proves idempotent registration: calling registration twice keeps exactly one scheduler entry', async () => {
      process.env.PROCESS_ROLE = 'worker';

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        mockJobSeekerService as unknown as JobSeekerService,
      );

      if (redisAvailable) {
        try {
          await job.onModuleInit();
          await job.scheduleDailyJob('0 0 * * *');

          const schedulers = await job.getJobSchedulers();
          const matchingSchedulers = schedulers.filter(
            (s) =>
              s.id === 'daily-no-pickup-evaluation-scheduler' ||
              s.name === NO_PICKUP_EVALUATION_JOB,
          );

          expect(matchingSchedulers.length).toBe(1);
          expect(matchingSchedulers[0].pattern).toBe('0 0 * * *');

          await job.removeJobScheduler('daily-no-pickup-evaluation-scheduler');
        } finally {
          await job.close(true);
        }
      } else {
        const mockQueue = {
          upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
          getJobSchedulers: jest.fn().mockResolvedValue([
            {
              id: 'daily-no-pickup-evaluation-scheduler',
              name: NO_PICKUP_EVALUATION_JOB,
              pattern: '0 0 * * *',
            },
          ]),
          removeJobScheduler: jest.fn().mockResolvedValue(true),
          close: jest.fn().mockResolvedValue(undefined),
        };
        jest.spyOn(job, 'getQueue').mockReturnValue(mockQueue as unknown as Queue);
        jest
          .spyOn(job, 'getWorker')
          .mockReturnValue({ close: jest.fn() } as unknown as Worker);

        await job.onModuleInit();
        await job.scheduleDailyJob('0 0 * * *');

        expect(mockQueue.upsertJobScheduler).toHaveBeenCalledTimes(2);
        const schedulers = await job.getJobSchedulers();
        expect(schedulers.length).toBe(1);
        await job.close(true);
      }
    });
  });
});
