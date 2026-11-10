import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService, JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { JobsController } from './jobs.controller';
import {
  NoPickupEvaluationJob,
  NO_PICKUP_EVALUATION_JOB,
} from './no-pickup-evaluation.job';
import { PlacementCompletionJob } from './placement-completion.job';
import { ClaimOverdueJob } from './claim-overdue.job';
import { FollowUpJob } from './follow-up.job';
import { PatternFlagsJob } from './pattern-flags.job';
import { JoiningRewardJob } from './joining-reward.job';
import { RetentionCleanupJob } from './retention-cleanup.job';
import { KycRecoveryJob } from './kyc-recovery.job';
import { RetentionService } from '../modules/retention/retention.service';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { JobSeekerService } from '../modules/job-seeker/job-seeker.service';
import { JwtStrategy } from '../common/auth/jwt.strategy';
import { AuthClock } from '../common/auth/auth.service';
import { PricingService } from '../modules/pricing/pricing.service';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { RbacGuard } from '../common/rbac/rbac.guard';
import { AuthThrottlerGuard } from '../common/auth/auth-throttler.guard';
import { JwtPayload } from '../common/auth/jwt-payload.interface';
import { Role } from '../common/rbac/rbac.types';
import { Queue } from 'bullmq';

describe('Phase 6.5 Task 2: Manual Trigger Endpoint for No-Pickup Evaluation Sweep', () => {
  describe('1. Unit Tests for triggerJob()', () => {
    it('returns the enqueued job id when BullMQ generates an ID', async () => {
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'job-12345' }),
      } as unknown as Queue;

      const job = new NoPickupEvaluationJob(
        {} as PrismaService,
        {} as JobSeekerService,
      );
      jest.spyOn(job, 'getQueue').mockReturnValue(mockQueue);

      const returnedId = await job.triggerJob('custom-req-id');

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(NO_PICKUP_EVALUATION_JOB, {
        requestId: 'custom-req-id',
      });
      expect(returnedId).toBe('job-12345');
    });

    it('honestly handles job.id being undefined without casting it away', async () => {
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: undefined }),
      } as unknown as Queue;

      const job = new NoPickupEvaluationJob(
        {} as PrismaService,
        {} as JobSeekerService,
      );
      jest.spyOn(job, 'getQueue').mockReturnValue(mockQueue);

      const returnedId = await job.triggerJob();

      expect(returnedId).toBeUndefined();
    });
  });

  describe('2. Endpoint & Guard Integration Tests (POST /jobs/no-pickup-evaluation/run)', () => {
    let app: INestApplication;
    let jwtService: JwtService;
    let mockJobService: { triggerJob: jest.Mock };
    let mockAuditService: { log: jest.Mock };
    let mockKycJobService: { triggerJob: jest.Mock };
    let mockPrisma: Partial<PrismaService>;

    const JWT_SECRET = 'test_jwt_secret_for_jobs_controller_spec_32chars';
    const originalJwtSecret = process.env.JWT_SECRET;

    beforeAll(async () => {
      process.env.JWT_SECRET = JWT_SECRET;
      mockJobService = {
        triggerJob: jest.fn().mockResolvedValue('enqueued-job-777'),
      };

      mockAuditService = {
        log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      };
      mockKycJobService = { triggerJob: jest.fn().mockResolvedValue('kyc-recovery-job-1') };

      mockPrisma = {
        staffSession: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      } as unknown as Partial<PrismaService>;

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot([
            {
              ttl: 60000,
              limit: 5,
            },
          ]),
          PassportModule.register({ defaultStrategy: 'jwt' }),
          JwtModule.register({
            secret: JWT_SECRET,
            signOptions: { expiresIn: '1h' },
          }),
        ],
        controllers: [JobsController],
        providers: [
          JwtStrategy,
          AuthClock,
          JwtAuthGuard,
          RbacGuard,
          AuthThrottlerGuard,
          { provide: NoPickupEvaluationJob, useValue: mockJobService },
          { provide: PlacementCompletionJob, useValue: { process: jest.fn().mockResolvedValue({ completed: 0 }) } },
          { provide: ClaimOverdueJob, useValue: { process: jest.fn().mockResolvedValue({ raised: 0 }) } },
          { provide: FollowUpJob, useValue: { process: jest.fn().mockResolvedValue({ created: 0, missed: 0 }) } },
          { provide: PatternFlagsJob, useValue: { process: jest.fn().mockResolvedValue({ businessManyRejections: 0, businessStopped: 0, agentRejection: 0 }) } },
          { provide: JoiningRewardJob, useValue: { process: jest.fn().mockResolvedValue({ queued: 0 }) } },
          {
            provide: RetentionCleanupJob,
            useValue: {
              process: jest.fn().mockResolvedValue({
                dryRun: false,
                profilesAnonymised: { total: 0 },
                recordingsDeleted: 0,
                accessLogsDeleted: { total: 0 },
                moneyRecordsDeleted: { total: 0 },
              }),
            },
          },
          { provide: RetentionService, useValue: { getLatestSummary: jest.fn().mockResolvedValue(null) } },
          { provide: KycRecoveryJob, useValue: mockKycJobService },
          { provide: AuditService, useValue: mockAuditService },
          { provide: PrismaService, useValue: mockPrisma },
          { provide: PricingService, useValue: { current: jest.fn() } },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();

      jwtService = moduleRef.get<JwtService>(JwtService);
    });

    afterAll(async () => {
      if (originalJwtSecret === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = originalJwtSecret;
      }
      if (app) {
        await app.close();
      }
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    const createToken = (role: Role, extra: Partial<JwtPayload> = {}): string => {
      const payload: JwtPayload = {
        sub: `staff-${role}-id`,
        role,
        email: `${role}@laboura.local`,
        code: `STF-${role.substring(0, 2).toUpperCase()}-00001`,
        ...extra,
      };
      return jwtService.sign(payload);
    };

    it('refuses unauthenticated requests with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .post('/jobs/no-pickup-evaluation/run')
        .expect(401);

      expect(mockJobService.triggerJob).not.toHaveBeenCalled();
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    it('refuses tokens restricted to totp_setup scope with 403 Forbidden', async () => {
      const totpSetupToken = createToken('ceo', { scope: 'totp_setup' });

      await request(app.getHttpServer())
        .post('/jobs/no-pickup-evaluation/run')
        .set('Authorization', `Bearer ${totpSetupToken}`)
        .expect(403);

      expect(mockJobService.triggerJob).not.toHaveBeenCalled();
    });

    const nonCeoRoles: Role[] = [
      'manager',
      'call_agent',
      'field_agent',
      'finance',
      'team_lead',
    ];

    for (const nonCeoRole of nonCeoRoles) {
      it(`refuses non-CEO role '${nonCeoRole}' with 403 Forbidden`, async () => {
        const token = createToken(nonCeoRole);

        await request(app.getHttpServer())
          .post('/jobs/no-pickup-evaluation/run')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);

        expect(mockJobService.triggerJob).not.toHaveBeenCalled();
        expect(mockAuditService.log).not.toHaveBeenCalled();
      });
    }

    it('allows CEO to enqueue exactly one job, returning the enqueued job id and audit logging', async () => {
      mockJobService.triggerJob.mockResolvedValueOnce('enqueued-job-888');
      const ceoToken = createToken('ceo');

      const response = await request(app.getHttpServer())
        .post('/jobs/no-pickup-evaluation/run')
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(201);

      expect(response.body).toEqual({ jobId: 'enqueued-job-888' });
      expect(mockJobService.triggerJob).toHaveBeenCalledTimes(1);

      expect(mockAuditService.log).toHaveBeenCalledTimes(1);
      expect(mockAuditService.log).toHaveBeenCalledWith({
        actorId: 'staff-ceo-id',
        action: 'job.manual_trigger',
        entityType: 'job',
        entityCode: 'no-pickup-evaluation',
        after: { jobId: 'enqueued-job-888' },
        city: 'Bengaluru',
      });
    });

    it('allows only the CEO to manually enqueue the KYC recovery probe and audits it', async () => {
      const manager = createToken('manager');
      await request(app.getHttpServer())
        .post('/jobs/kyc-recovery/run')
        .set('Authorization', `Bearer ${manager}`)
        .expect(403);
      expect(mockKycJobService.triggerJob).not.toHaveBeenCalled();

      const response = await request(app.getHttpServer())
        .post('/jobs/kyc-recovery/run')
        .set('Authorization', `Bearer ${createToken('ceo')}`)
        .expect(201);
      expect(response.body).toEqual({ jobId: 'kyc-recovery-job-1' });
      expect(mockKycJobService.triggerJob).toHaveBeenCalledTimes(1);
      expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
        entityCode: 'kyc-recovery',
        action: 'job.manual_trigger',
      }));
    });

    it('rate-limits excessive trigger requests with HTTP 429 Too Many Requests', async () => {
      const ceoToken = createToken('ceo');
      // Throttler limit was configured as 5 per 60000ms.
      // Send multiple requests until throttler responds with 429.
      const responses: number[] = [];

      for (let i = 0; i < 7; i++) {
        const res = await request(app.getHttpServer())
          .post('/jobs/no-pickup-evaluation/run')
          .set('Authorization', `Bearer ${ceoToken}`)
          .send({ requestId: 'flood-test-req' });
        responses.push(res.status);
      }

      expect(responses).toContain(429);
    });
  });
});
