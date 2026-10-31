import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../common/prisma/prisma.service';
import { AlertService } from '../common/observability/alert.service';
import {
  SweepMonitoringService,
  ALERT_THROTTLE_MS,
} from './sweep-monitoring.service';
import {
  NoPickupEvaluationJob,
  NO_PICKUP_EVALUATION_JOB,
} from './no-pickup-evaluation.job';
import { JobSeekerService } from '../modules/job-seeker/job-seeker.service';
import { HealthService } from '../health/health.service';
import { HealthController } from '../health/health.controller';

interface JobRunRecord {
  id: string;
  jobName: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: string;
  evaluated: number;
  hitsRecorded: number;
  details?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface JobAlertStateRecord {
  jobName: string;
  isStale: boolean;
  lastAlertedAt: Date | null;
  lastRecoveredAt: Date | null;
  updatedAt: Date;
}

interface MockPrismaClient {
  jobRun: {
    findFirst: jest.Mock<
      Promise<JobRunRecord | null>,
      [{ where?: { jobName?: string; outcome?: string; finishedAt?: { not?: null } }; orderBy?: { finishedAt?: 'asc' | 'desc' } }]
    >;
    create: jest.Mock<
      Promise<JobRunRecord>,
      [{ data: { jobName: string; startedAt: Date; finishedAt: Date | null; outcome: string; evaluated: number; hitsRecorded: number; details?: unknown } }]
    >;
  };
  jobAlertState: {
    findUnique: jest.Mock<Promise<JobAlertStateRecord | null>, [{ where: { jobName: string } }]>;
    upsert: jest.Mock<
      Promise<JobAlertStateRecord>,
      [{ where: { jobName: string }; create: Partial<JobAlertStateRecord>; update: Partial<JobAlertStateRecord> }]
    >;
    update: jest.Mock<
      Promise<JobAlertStateRecord>,
      [{ where: { jobName: string }; data: Partial<JobAlertStateRecord> }]
    >;
  };
  staff: {
    findFirst: jest.Mock<Promise<{ id: string; createdAt: Date } | null>, []>;
  };
  jobSeeker: {
    findMany: jest.Mock<Promise<unknown[]>, []>;
  };
  $queryRawUnsafe: jest.Mock<Promise<unknown[]>, [string]>;
}

describe('Phase 6.5 Task 6: Sweep Staleness Detection & Alerting', () => {
  let sweepMonitoringService: SweepMonitoringService;
  let alertService: AlertService;

  let mockJobRuns: JobRunRecord[];
  let mockJobAlertStates: Map<string, JobAlertStateRecord>;
  let mockStaff: Array<{ id: string; createdAt: Date }>;
  let mockPrisma: MockPrismaClient;

  beforeEach(async () => {
    mockJobRuns = [];
    mockJobAlertStates = new Map();
    mockStaff = [{ id: 'staff-1', createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000) }]; // system 50h old

    mockPrisma = {
      jobRun: {
        findFirst: jest.fn().mockImplementation(({ where, orderBy }) => {
          let filtered = [...mockJobRuns];
          if (where?.jobName) {
            filtered = filtered.filter((r) => r.jobName === where.jobName);
          }
          if (where?.outcome) {
            filtered = filtered.filter((r) => r.outcome === where.outcome);
          }
          if (where?.finishedAt?.not === null) {
            filtered = filtered.filter((r) => r.finishedAt !== null);
          }
          if (orderBy?.finishedAt === 'desc') {
            filtered.sort(
              (a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0),
            );
          }
          return Promise.resolve(filtered[0] || null);
        }),
        create: jest.fn().mockImplementation(({ data }) => {
          const run: JobRunRecord = {
            id: `run-${Date.now()}-${Math.random()}`,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockJobRuns.push(run);
          return Promise.resolve(run);
        }),
      },
      jobAlertState: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(mockJobAlertStates.get(where.jobName) || null);
        }),
        upsert: jest.fn().mockImplementation(({ where, create, update }) => {
          const existing = mockJobAlertStates.get(where.jobName);
          const state: JobAlertStateRecord = existing
            ? { ...existing, ...update, updatedAt: new Date() }
            : { jobName: where.jobName, isStale: false, lastAlertedAt: null, lastRecoveredAt: null, ...create, updatedAt: new Date() };
          mockJobAlertStates.set(where.jobName, state);
          return Promise.resolve(state);
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const existing = mockJobAlertStates.get(where.jobName)!;
          const state: JobAlertStateRecord = { ...existing, ...data, updatedAt: new Date() };
          mockJobAlertStates.set(where.jobName, state);
          return Promise.resolve(state);
        }),
      },
      staff: {
        findFirst: jest.fn().mockImplementation(() => {
          return Promise.resolve(mockStaff[0] || null);
        }),
      },
      jobSeeker: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ '1': 1 }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SweepMonitoringService,
        AlertService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    sweepMonitoringService = module.get<SweepMonitoringService>(SweepMonitoringService);
    alertService = module.get<AlertService>(AlertService);
    alertService.clearDispatchedAlerts();
  });

  afterEach(() => {
    sweepMonitoringService.onModuleDestroy();
  });

  describe('1. Durable Recording in JobRun table', () => {
    it('records a successful JobRun on sweep completion with startedAt, finishedAt, evaluated, and hitsRecorded', async () => {
      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        {} as JobSeekerService,
      );

      const result = await job.evaluateNoPickups();

      expect(result).toBeDefined();
      expect(mockPrisma.jobRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobName: NO_PICKUP_EVALUATION_JOB,
            outcome: 'success',
            evaluated: 0,
            hitsRecorded: 0,
            startedAt: expect.any(Date),
            finishedAt: expect.any(Date),
          }),
        }),
      );

      const created = mockJobRuns.find((r) => r.jobName === NO_PICKUP_EVALUATION_JOB);
      expect(created).toBeDefined();
      expect(created?.outcome).toBe('success');
    });

    it('records a failed JobRun on unexpected fatal sweep exception and rethrows', async () => {
      mockPrisma.jobSeeker.findMany.mockRejectedValueOnce(
        new Error('Database disk full error'),
      );

      const job = new NoPickupEvaluationJob(
        mockPrisma as unknown as PrismaService,
        {} as JobSeekerService,
      );

      await expect(job.evaluateNoPickups()).rejects.toThrow('Database disk full error');

      expect(mockPrisma.jobRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobName: NO_PICKUP_EVALUATION_JOB,
            outcome: 'failed',
            details: { error: 'Database disk full error' },
          }),
        }),
      );
    });
  });

  describe('2. 36-Hour Staleness Evaluation & Alerting', () => {
    it('does NOT raise an alert when the latest sweep is recent (10 hours ago)', async () => {
      const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);
      mockJobRuns.push({
        id: 'run-1',
        jobName: NO_PICKUP_EVALUATION_JOB,
        startedAt: tenHoursAgo,
        finishedAt: tenHoursAgo,
        outcome: 'success',
        evaluated: 10,
        hitsRecorded: 1,
        createdAt: tenHoursAgo,
        updatedAt: tenHoursAgo,
      });

      const res = await sweepMonitoringService.checkSweepStaleness();

      expect(res.status).toBe('healthy');
      expect(res.alertSent).toBe(false);
      expect(alertService.getDispatchedAlerts().length).toBe(0);
    });

    it('does NOT raise an alert at the 35-hour boundary', async () => {
      const baseTime = new Date('2026-10-31T00:00:00Z');
      const thirtyFiveHoursLater = new Date(baseTime.getTime() + 35 * 60 * 60 * 1000);

      mockJobRuns.push({
        id: 'run-1',
        jobName: NO_PICKUP_EVALUATION_JOB,
        startedAt: baseTime,
        finishedAt: baseTime,
        outcome: 'success',
        evaluated: 5,
        hitsRecorded: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
      });

      const res = await sweepMonitoringService.checkSweepStaleness(thirtyFiveHoursLater);

      expect(res.status).toBe('healthy');
      expect(res.alertSent).toBe(false);
      expect(alertService.getDispatchedAlerts().length).toBe(0);
    });

    it('raises a CRITICAL alert when the sweep gap exceeds 36 hours (37 hours ago)', async () => {
      const baseTime = new Date('2026-10-31T00:00:00Z');
      const thirtySevenHoursLater = new Date(baseTime.getTime() + 37 * 60 * 60 * 1000);

      mockJobRuns.push({
        id: 'run-1',
        jobName: NO_PICKUP_EVALUATION_JOB,
        startedAt: baseTime,
        finishedAt: baseTime,
        outcome: 'success',
        evaluated: 5,
        hitsRecorded: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
      });

      const res = await sweepMonitoringService.checkSweepStaleness(thirtySevenHoursLater);

      expect(res.status).toBe('stale');
      expect(res.alertSent).toBe(true);
      expect(res.hoursElapsed).toBe(37);

      const alerts = alertService.getDispatchedAlerts();
      expect(alerts.length).toBe(1);
      expect(alerts[0].severity).toBe('critical');
      expect(alerts[0].title).toContain('Daily No-Pickup Sweep Stale (> 36h)');
      expect(alerts[0].message).toContain('37 hours');

      // State is persisted in database
      const state = mockJobAlertStates.get(NO_PICKUP_EVALUATION_JOB);
      expect(state).toBeDefined();
      expect(state?.isStale).toBe(true);
      expect(state?.lastAlertedAt).toEqual(thirtySevenHoursLater);
    });
  });

  describe('3. Database Throttle State (Survives Restarts & Deduplicates Instances)', () => {
    it('throttles subsequent alerts within the 6-hour window while still stale', async () => {
      const baseTime = new Date('2026-10-31T00:00:00Z');
      const thirtySevenHoursLater = new Date(baseTime.getTime() + 37 * 60 * 60 * 1000);
      const thirtyEightHoursLater = new Date(baseTime.getTime() + 38 * 60 * 60 * 1000);

      mockJobRuns.push({
        id: 'run-1',
        jobName: NO_PICKUP_EVALUATION_JOB,
        startedAt: baseTime,
        finishedAt: baseTime,
        outcome: 'success',
        evaluated: 5,
        hitsRecorded: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
      });

      // 1. Initial trigger at hour 37 sends alert
      await sweepMonitoringService.checkSweepStaleness(thirtySevenHoursLater);
      expect(alertService.getDispatchedAlerts().length).toBe(1);

      // 2. Second check at hour 38 (1 hour later) within 6h throttle: reports stale, but suppresses alert
      const secondCheck = await sweepMonitoringService.checkSweepStaleness(thirtyEightHoursLater);
      expect(secondCheck.status).toBe('stale');
      expect(secondCheck.alertSent).toBe(false);
      expect(alertService.getDispatchedAlerts().length).toBe(1); // No duplicate alert
    });

    it('sends a reminder alert once the 6-hour throttle window has expired', async () => {
      const baseTime = new Date('2026-10-31T00:00:00Z');
      const initialAlertTime = new Date(baseTime.getTime() + 37 * 60 * 60 * 1000);
      const reminderTime = new Date(initialAlertTime.getTime() + ALERT_THROTTLE_MS + 1000);

      mockJobRuns.push({
        id: 'run-1',
        jobName: NO_PICKUP_EVALUATION_JOB,
        startedAt: baseTime,
        finishedAt: baseTime,
        outcome: 'success',
        evaluated: 5,
        hitsRecorded: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
      });

      // Hour 37 alert
      await sweepMonitoringService.checkSweepStaleness(initialAlertTime);
      expect(alertService.getDispatchedAlerts().length).toBe(1);

      // 6.5 hours later: throttle expired, reminder alert fires
      const reminderCheck = await sweepMonitoringService.checkSweepStaleness(reminderTime);
      expect(reminderCheck.status).toBe('stale');
      expect(reminderCheck.alertSent).toBe(true);
      expect(alertService.getDispatchedAlerts().length).toBe(2);
    });
  });

  describe('4. Recovery Notification (Alert on Recovery)', () => {
    it('dispatches a recovery alert when a sweep succeeds after being in a stale state', async () => {
      const baseTime = new Date('2026-10-31T00:00:00Z');
      const staleTime = new Date(baseTime.getTime() + 40 * 60 * 60 * 1000);

      mockJobRuns.push({
        id: 'run-1',
        jobName: NO_PICKUP_EVALUATION_JOB,
        startedAt: baseTime,
        finishedAt: baseTime,
        outcome: 'success',
        evaluated: 5,
        hitsRecorded: 0,
        createdAt: baseTime,
        updatedAt: baseTime,
      });

      // 1. Enter stale state
      await sweepMonitoringService.checkSweepStaleness(staleTime);
      expect(alertService.getDispatchedAlerts().length).toBe(1);
      expect(mockJobAlertStates.get(NO_PICKUP_EVALUATION_JOB)?.isStale).toBe(true);

      // 2. Sweep now runs successfully at staleTime + 1 hour
      const recoveredRunTime = new Date(staleTime.getTime() + 1 * 60 * 60 * 1000);
      mockJobRuns.push({
        id: 'run-2',
        jobName: NO_PICKUP_EVALUATION_JOB,
        startedAt: recoveredRunTime,
        finishedAt: recoveredRunTime,
        outcome: 'success',
        evaluated: 12,
        hitsRecorded: 2,
        createdAt: recoveredRunTime,
        updatedAt: recoveredRunTime,
      });

      // 3. Monitor runs 10 minutes later
      const recoveryCheckTime = new Date(recoveredRunTime.getTime() + 10 * 60 * 1000);
      const res = await sweepMonitoringService.checkSweepStaleness(recoveryCheckTime);

      expect(res.status).toBe('healthy');
      expect(res.alertSent).toBe(true);

      const alerts = alertService.getDispatchedAlerts();
      expect(alerts.length).toBe(2);
      expect(alerts[1].severity).toBe('info');
      expect(alerts[1].title).toContain('Daily No-Pickup Sweep Recovered');

      // State is updated in database
      const state = mockJobAlertStates.get(NO_PICKUP_EVALUATION_JOB);
      expect(state?.isStale).toBe(false);
      expect(state?.lastRecoveredAt).toEqual(recoveryCheckTime);

      // 4. Subsequent healthy check does NOT re-send recovery alert
      const nextHealthyTime = new Date(recoveryCheckTime.getTime() + 30 * 60 * 1000);
      const nextRes = await sweepMonitoringService.checkSweepStaleness(nextHealthyTime);
      expect(nextRes.status).toBe('healthy');
      expect(nextRes.alertSent).toBe(false);
      expect(alertService.getDispatchedAlerts().length).toBe(2);
    });
  });

  describe('5. Unpopulated & Brand New System Edge Cases', () => {
    it('does NOT alert when no sweep has run but the database is newly created (< 36 hours old)', async () => {
      mockJobRuns = []; // No job run
      mockStaff = [{ id: 'staff-1', createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000) }]; // system only 4h old

      const res = await sweepMonitoringService.checkSweepStaleness();

      expect(res.status).toBe('healthy');
      expect(res.alertSent).toBe(false);
      expect(alertService.getDispatchedAlerts().length).toBe(0);
    });

    it('ALERTS when no sweep has run and the database has existed for > 36 hours', async () => {
      mockJobRuns = []; // No job run
      mockStaff = [{ id: 'staff-1', createdAt: new Date(Date.now() - 40 * 60 * 60 * 1000) }]; // system 40h old

      const res = await sweepMonitoringService.checkSweepStaleness();

      expect(res.status).toBe('stale');
      expect(res.alertSent).toBe(true);
      expect(alertService.getDispatchedAlerts().length).toBe(1);
    });
  });

  describe('6. Process Role Gating & Separation', () => {
    const originalRole = process.env.PROCESS_ROLE;

    afterEach(() => {
      if (originalRole === undefined) {
        delete process.env.PROCESS_ROLE;
      } else {
        process.env.PROCESS_ROLE = originalRole;
      }
    });

    it('does NOT start the interval timer when PROCESS_ROLE === "worker"', async () => {
      process.env.PROCESS_ROLE = 'worker';
      const checkSpy = jest.spyOn(sweepMonitoringService, 'checkSweepStaleness');

      await sweepMonitoringService.onModuleInit();

      expect(checkSpy).not.toHaveBeenCalled();
    });

    it('starts check and sets interval when PROCESS_ROLE === "web"', async () => {
      process.env.PROCESS_ROLE = 'web';
      const checkSpy = jest.spyOn(sweepMonitoringService, 'checkSweepStaleness').mockResolvedValue({
        status: 'healthy',
        hoursElapsed: 0,
        lastCompletedAt: new Date(),
        alertSent: false,
      });

      await sweepMonitoringService.onModuleInit();

      expect(checkSpy).toHaveBeenCalled();
    });
  });

  describe('7. GET /health/ready Status Code Integrity (Ruling 1)', () => {
    it('does NOT return 503 when sweep is stale; reports sweep status in body and keeps 200 HTTP status', async () => {
      // Mock HealthService with stale sweep
      const healthService = new HealthService(mockPrisma as unknown as PrismaService);
      jest.spyOn(healthService, 'checkDatabase').mockResolvedValue({ healthy: true });
      jest.spyOn(healthService, 'checkRedis').mockResolvedValue({ healthy: true });
      jest.spyOn(healthService, 'checkSweepInfo').mockResolvedValue({
        status: 'stale',
        hoursElapsed: 42,
        lastCompletedAt: new Date(Date.now() - 42 * 60 * 60 * 1000).toISOString(),
      });

      const controller = new HealthController(healthService);
      const res = await controller.getReadiness();

      expect(res.status).toBe('ready');
      expect(res.postgres).toBe('ok');
      expect(res.redis).toBe('ok');
      expect(res.sweep).toBeDefined();
      expect(res.sweep?.status).toBe('stale');
      expect(res.sweep?.hoursElapsed).toBe(42);
    });
  });
});
