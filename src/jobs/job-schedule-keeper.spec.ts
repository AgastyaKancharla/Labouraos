import Redis from 'ioredis';
import { JobScheduleKeeper } from './job-schedule-keeper.service';
import { JOB_CATALOG, schedulerSetKey } from './job-catalog';
import { missingSchedules } from './job-schedule-check';
import { PrismaService } from '../common/prisma/prisma.service';
import { AlertService } from '../common/observability/alert.service';
import { HealthService } from '../health/health.service';
import { HealthController } from '../health/health.controller';
import { HttpException } from '@nestjs/common';
import { NoPickupEvaluationJob } from './no-pickup-evaluation.job';
import { ForgottenLogoutJob } from './forgotten-logout.job';
import { PlacementCompletionJob } from './placement-completion.job';
import { ClaimOverdueJob } from './claim-overdue.job';
import { JoiningRewardJob } from './joining-reward.job';
import { PatternFlagsJob } from './pattern-flags.job';
import { RetentionCleanupJob } from './retention-cleanup.job';
import { FollowUpJob } from './follow-up.job';
import { ShortageTasksJob } from './shortage-tasks.job';
import { WinBackJob } from './win-back.job';
import { WeeklyReportJob } from './weekly-report.job';
import { InterviewReplyJob } from './interview-reply.job';
import { KycRecoveryJob } from './kyc-recovery.job';
import { NotificationSweepJob } from './notification-sweep.job';
import { CustomerPushJob } from './customer-push.job';

type Fake = { schedule: jest.Mock; scheduleDailyJob: jest.Mock; process: jest.Mock; evaluateNoPickups: jest.Mock };

function fakeJob(result: unknown = { done: 1 }): Fake {
  return {
    schedule: jest.fn().mockResolvedValue(undefined),
    scheduleDailyJob: jest.fn().mockResolvedValue(undefined),
    process: jest.fn().mockResolvedValue(result),
    evaluateNoPickups: jest.fn().mockResolvedValue({ evaluated: 3 }),
  };
}

function buildWithFakes() {
  const jobs = Array.from({ length: JOB_CATALOG.length }, () => fakeJob());
  const prisma = { jobRun: { create: jest.fn().mockResolvedValue({}) } };
  const alerts = { sendAlert: jest.fn().mockResolvedValue(true) };
  const keeper = new (JobScheduleKeeper as unknown as new (...args: unknown[]) => JobScheduleKeeper)(
    ...jobs,
    prisma as unknown as PrismaService,
    alerts as unknown as AlertService,
  );
  return { keeper, jobs, prisma, alerts };
}

const originalRole = process.env.PROCESS_ROLE;
afterEach(() => {
  if (originalRole === undefined) delete process.env.PROCESS_ROLE;
  else process.env.PROCESS_ROLE = originalRole;
});

describe('H3: JobScheduleKeeper keeps every schedule in Redis and runs any job on demand', () => {
  it('knows every job in the catalog', () => {
    const { keeper } = buildWithFakes();
    expect(keeper.keys().sort()).toEqual(JOB_CATALOG.map((e) => e.key).sort());
  });

  it('re-registers every schedule (no-pickup through its own daily scheduler)', async () => {
    const { keeper, jobs } = buildWithFakes();
    const result = await keeper.ensureAll('test');
    expect(result.failed).toEqual([]);
    expect(result.registered).toHaveLength(JOB_CATALOG.length);
    expect(jobs[0].scheduleDailyJob).toHaveBeenCalledTimes(1);
    for (const job of jobs.slice(1)) expect(job.schedule).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one schedule fails, and reports which', async () => {
    const { keeper, jobs } = buildWithFakes();
    jobs[3].schedule.mockRejectedValue(new Error('Redis down'));
    const result = await keeper.ensureAll('test');
    expect(result.registered).toHaveLength(JOB_CATALOG.length - 1);
    expect(result.failed).toEqual([{ key: 'claimOverdue', error: 'Redis down' }]);
  });

  it('self-check: puts the schedules back and alerts only when some are missing', async () => {
    const { keeper, jobs, alerts } = buildWithFakes();
    const present = { zscore: jest.fn().mockResolvedValue('1700000000000') };
    await expect(keeper.checkAndRepair(present)).resolves.toEqual([]);
    expect(jobs[1].schedule).not.toHaveBeenCalled();
    expect(alerts.sendAlert).not.toHaveBeenCalled();

    const wiped = {
      zscore: jest.fn((key: string) =>
        Promise.resolve(key === schedulerSetKey('win-back') || key === schedulerSetKey('follow-up') ? null : '1'),
      ),
    };
    const missing = await keeper.checkAndRepair(wiped);
    expect(missing.sort()).toEqual(['followUp', 'winBack']);
    for (const job of jobs.slice(1)) expect(job.schedule).toHaveBeenCalledTimes(1);
    expect(alerts.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning', metadata: { missing } }));
  });

  it('run now calls the job\'s own work directly and records a JobRun row', async () => {
    const { keeper, jobs, prisma } = buildWithFakes();
    jobs[4].process.mockResolvedValue({ queued: 2 });
    const { job, result } = await keeper.run('joiningReward');
    expect(job.key).toBe('joiningReward');
    expect(result).toEqual({ queued: 2 });
    expect(jobs[4].process).toHaveBeenCalledTimes(1);
    expect(prisma.jobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ jobName: 'daily-joining-reward', outcome: 'success', details: { queued: 2 } }),
    });
  });

  it('run now for jobs that record their own runs does not write a second JobRun', async () => {
    const { keeper, jobs, prisma } = buildWithFakes();
    await keeper.run('noPickupEvaluation');
    expect(jobs[0].evaluateNoPickups).toHaveBeenCalledTimes(1);
    expect(prisma.jobRun.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown job', async () => {
    const { keeper } = buildWithFakes();
    await expect(keeper.run('nope')).rejects.toThrow("Unknown job 'nope'");
  });

  it('does nothing at start in a web-only process', async () => {
    process.env.PROCESS_ROLE = 'web';
    const { keeper, jobs } = buildWithFakes();
    await keeper.onApplicationBootstrap();
    expect(jobs[1].schedule).not.toHaveBeenCalled();
    await keeper.onModuleDestroy();
  });
});

async function redisReachable(): Promise<boolean> {
  const client = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    lazyConnect: true,
    connectTimeout: 500,
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

describe('H3 with a real Redis: a Key Value restart wipes the schedules; the health check sees it and the keeper repairs it', () => {
  let available = false;
  let redis: Redis;
  const originalCheck = process.env.WORKER_HEARTBEAT_CHECK;

  // Real job objects: only their queue (and so Redis) is used by schedule().
  const construct = <T>(C: new (...args: never[]) => T): T => new C(...(Array(8).fill(undefined) as never[]));
  const realJobs = () => [
    construct(NoPickupEvaluationJob),
    construct(ForgottenLogoutJob),
    construct(PlacementCompletionJob),
    construct(ClaimOverdueJob),
    construct(JoiningRewardJob),
    construct(PatternFlagsJob),
    construct(RetentionCleanupJob),
    construct(FollowUpJob),
    construct(ShortageTasksJob),
    construct(WinBackJob),
    construct(WeeklyReportJob),
    construct(InterviewReplyJob),
    construct(KycRecoveryJob),
    construct(NotificationSweepJob),
    construct(CustomerPushJob),
  ];

  beforeAll(async () => {
    available = await redisReachable();
    if (available) {
      redis = new Redis({ host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT) || 6379 });
    }
  });

  afterAll(async () => {
    if (originalCheck === undefined) delete process.env.WORKER_HEARTBEAT_CHECK;
    else process.env.WORKER_HEARTBEAT_CHECK = originalCheck;
    if (!available) return;
    // Leave no schedule or queued run behind for later suites.
    for (const entry of JOB_CATALOG) {
      const keys = await redis.keys(`bull:${entry.queue}:*`);
      if (keys.length) await redis.del(...keys);
    }
    redis.disconnect();
  });

  it('registers, loses, reports and restores every schedule', async () => {
    if (!available) {
      console.warn('Redis not reachable; skipping the real-Redis schedule test');
      return;
    }
    const jobs = realJobs();
    const alerts = { sendAlert: jest.fn().mockResolvedValue(true) };
    const keeper = new (JobScheduleKeeper as unknown as new (...args: unknown[]) => JobScheduleKeeper)(
      ...jobs,
      undefined,
      alerts as unknown as AlertService,
    );
    const wipeQueues = async () => {
      for (const entry of JOB_CATALOG) {
        const keys = await redis.keys(`bull:${entry.queue}:*`);
        if (keys.length) await redis.del(...keys);
      }
    };
    try {
      await wipeQueues();
      const first = await keeper.ensureAll('test');
      expect(first.failed).toEqual([]);
      expect(await missingSchedules(redis)).toEqual([]);

      // Simulate a free Key Value restart: everything these queues kept is gone
      // (the scheduler sets, the scheduler records and the next delayed runs).
      for (const entry of JOB_CATALOG) {
        const keys = await redis.keys(`bull:${entry.queue}:*`);
        if (keys.length) await redis.del(...keys);
      }
      expect((await missingSchedules(redis)).map((e) => e.key).sort()).toEqual(JOB_CATALOG.map((e) => e.key).sort());

      // /health/ready answers 503 naming `schedules`.
      process.env.WORKER_HEARTBEAT_CHECK = 'true';
      const health = new HealthService({ $queryRawUnsafe: jest.fn().mockResolvedValue([1]) } as unknown as PrismaService);
      jest.spyOn(health, 'checkWorkerHeartbeat').mockResolvedValue({ status: 'alive', lastBeatAt: null, secondsAgo: 0 });
      jest.spyOn(health, 'checkSweepInfo').mockResolvedValue(undefined);
      const schedules = await health.checkSchedules(2000);
      expect(schedules.status).toBe('missing');
      expect(schedules.missing).toHaveLength(JOB_CATALOG.length);
      await expect(new HealthController(health).getReadiness()).rejects.toBeInstanceOf(HttpException);
      try {
        await new HealthController(health).getReadiness();
      } catch (err) {
        expect((err as HttpException).getResponse()).toMatchObject({ failed: ['schedules'] });
      }

      // The periodic self-check puts them all back.
      const repaired = await keeper.checkAndRepair(redis);
      expect(repaired).toHaveLength(JOB_CATALOG.length);
      expect(await missingSchedules(redis)).toEqual([]);
      expect((await health.checkSchedules(2000)).status).toBe('ok');
      expect(alerts.sendAlert).toHaveBeenCalledTimes(1);
    } finally {
      await keeper.onModuleDestroy();
      for (const job of jobs) {
        const closer = job as unknown as { close?: (force?: boolean) => Promise<void>; onModuleDestroy?: () => Promise<void> };
        if (closer.close) await closer.close(true);
        else await closer.onModuleDestroy?.();
      }
    }
  });
});
