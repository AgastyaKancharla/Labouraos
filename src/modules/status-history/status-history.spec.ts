import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { recordStatusChange } from '../../common/status-history/status-history.helper';

describe('Phase 9 Task 7: Status History', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let jobSeekerService: JobSeekerService;
  let otpService: OtpService;

  let ceoToken: string;
  let managerToken: string;
  let callAgentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;

  let ceoStaffId: string;

  async function getVerifiedOtp(phone: string): Promise<string> {
    const { requestId } = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const code = mockProvider.getCode(requestId)!;
    await otpService.verifyOtp(requestId, code);
    return requestId;
  }

  function mkToken(staff: { id: string; role: string; code: string; city?: string }) {
    return jwtService.sign({
      sub: staff.id,
      role: staff.role,
      code: staff.code,
      city: staff.city ?? 'Bengaluru',
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    jobSeekerService = app.get(JobSeekerService);
    otpService = app.get(OtpService);

    // Clean up
    await prisma.statusHistory.deleteMany();

    // Create staff accounts
    const timestamp = Date.now();

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-SH-${timestamp}`,
        name: 'CEO StatusHistory',
        email: `ceo.sh.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'ceo',
        status: 'active',
      },
    });
    ceoStaffId = ceo.id;
    ceoToken = mkToken(ceo);

    const manager = await prisma.staff.create({
      data: {
        code: `MGR-SH-${timestamp}`,
        name: 'Manager StatusHistory',
        email: `mgr.sh.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'manager',
        status: 'active',
      },
    });
    managerToken = mkToken(manager);

    const ca = await prisma.staff.create({
      data: {
        code: `CA-SH-${timestamp}`,
        name: 'Call Agent StatusHistory',
        email: `ca.sh.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'call_agent',
        status: 'active',
      },
    });
    callAgentToken = mkToken(ca);

    const fa = await prisma.staff.create({
      data: {
        code: `FA-SH-${timestamp}`,
        name: 'Field Agent StatusHistory',
        email: `fa.sh.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'field_agent',
        status: 'active',
      },
    });
    fieldAgentToken = mkToken(fa);

    const fin = await prisma.staff.create({
      data: {
        code: `FIN-SH-${timestamp}`,
        name: 'Finance StatusHistory',
        email: `fin.sh.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'finance',
        status: 'active',
      },
    });
    financeToken = mkToken(fin);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('RBAC for GET /status-history', () => {
    it('returns 400 when subjectType or subjectId query params are missing', async () => {
      await request(app.getHttpServer())
        .get('/status-history')
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .get('/status-history?subjectType=job_seeker')
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(400);
    });

    it('allows CEO to query status history', async () => {
      const res = await request(app.getHttpServer())
        .get('/status-history?subjectType=job_seeker&subjectId=non-existent-id')
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('allows Manager to query status history', async () => {
      const res = await request(app.getHttpServer())
        .get('/status-history?subjectType=job_seeker&subjectId=non-existent-id')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('refuses Call Agent with 403', async () => {
      await request(app.getHttpServer())
        .get('/status-history?subjectType=job_seeker&subjectId=non-existent-id')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(403);
    });

    it('refuses Field Agent with 403', async () => {
      await request(app.getHttpServer())
        .get('/status-history?subjectType=job_seeker&subjectId=non-existent-id')
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .expect(403);
    });

    it('refuses Finance with 403', async () => {
      await request(app.getHttpServer())
        .get('/status-history?subjectType=job_seeker&subjectId=non-existent-id')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(403);
    });
  });

  describe('Job Seeker lifecycle status history tracking', () => {
    it('records creating, activating, deactivating and reactivating a job seeker in order', async () => {
      // 1. Create job seeker
      const phone = `+91987${Date.now().toString().slice(-7)}`;
      const otpRequestId = await getVerifiedOtp(phone);

      const createRes = await request(app.getHttpServer())
        .post('/job-seekers')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          name: 'History Seeker',
          phone,
          otpRequestId,
          tradeSkill: 'Electrician',
          minSalary: 1500000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
        })
        .expect(201);

      const jobSeekerId = createRes.body.id;

      // Check history: should have fromStatus: null -> pending_payment
      let historyRes = await request(app.getHttpServer())
        .get(`/status-history?subjectType=job_seeker&subjectId=${jobSeekerId}`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);

      expect(historyRes.body).toHaveLength(1);
      expect(historyRes.body[0].fromStatus).toBeNull();
      expect(historyRes.body[0].toStatus).toBe('pending_payment');

      // 2. Activate via payment
      // Create payment
      const paymentRes = await request(app.getHttpServer())
        .post(`/job-seekers/${jobSeekerId}/activation-payment`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(201);

      const gatewayRef = paymentRes.body.gatewayReference;

      // Simulate payment webhook
      await request(app.getHttpServer())
        .post('/payments/webhook')
        .send({
          gatewayReference: gatewayRef,
          status: 'succeeded',
        })
        .expect(201);

      // Verify job seeker status is now active
      historyRes = await request(app.getHttpServer())
        .get(`/status-history?subjectType=job_seeker&subjectId=${jobSeekerId}`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);

      expect(historyRes.body).toHaveLength(2);
      expect(historyRes.body[1].fromStatus).toBe('pending_payment');
      expect(historyRes.body[1].toStatus).toBe('active');
      expect(historyRes.body[1].changedByStaffId).toBeNull(); // webhook is system actor

      // 3. Deactivate via 3 hits
      for (let i = 1; i <= 3; i++) {
        await request(app.getHttpServer())
          .post(`/job-seekers/${jobSeekerId}/hits`)
          .set('Authorization', `Bearer ${callAgentToken}`)
          .send({
            reason: 'offer_rejected',
            note: `Candidate rejected job offer #${i}`,
          })
          .expect(201);
      }

      historyRes = await request(app.getHttpServer())
        .get(`/status-history?subjectType=job_seeker&subjectId=${jobSeekerId}`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);

      expect(historyRes.body).toHaveLength(3);
      expect(historyRes.body[2].fromStatus).toBe('active');
      expect(historyRes.body[2].toStatus).toBe('deactivated');
      expect(historyRes.body[2].reason).toBe('hit_limit_reached');

      // 4. Reactivate via reactivation payment
      const reactivateRes = await request(app.getHttpServer())
        .post(`/job-seekers/${jobSeekerId}/reactivate`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(201);

      const reactivateGatewayRef = reactivateRes.body.gatewayReference;

      // Simulate webhook for reactivation
      await request(app.getHttpServer())
        .post('/payments/webhook')
        .send({
          gatewayReference: reactivateGatewayRef,
          status: 'succeeded',
        })
        .expect(201);

      historyRes = await request(app.getHttpServer())
        .get(`/status-history?subjectType=job_seeker&subjectId=${jobSeekerId}`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);

      expect(historyRes.body).toHaveLength(4);
      expect(historyRes.body[3].fromStatus).toBe('deactivated');
      expect(historyRes.body[3].toStatus).toBe('active');
      expect(historyRes.body[3].reason).toBe('reactivated_via_payment');
    });

    it('records daily sweep deactivation with null staff id (system)', async () => {
      // Create and activate candidate
      const sweepPhone = `+9177${Date.now().toString().slice(-8)}`;
      const js = await prisma.jobSeeker.create({
        data: {
          code: `JS-SWEEP-${Date.now()}`,
          name: 'Sweep Candidate',
          phone: sweepPhone,
          phoneVerified: true,
          tradeSkill: 'Electrician',
          minSalary: 1500000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          hitCount: 2,
        },
      });

      // Seed qualifying contact attempts for today so no_pickup hit is eligible
      const now = new Date();
      await prisma.contactAttempt.createMany({
        data: [
          {
            jobSeekerId: js.id,
            channel: 'call',
            timeOfDay: 'am',
            outcome: 'no_pickup',
            attemptedAt: now,
          },
          {
            jobSeekerId: js.id,
            channel: 'call',
            timeOfDay: 'pm',
            outcome: 'no_pickup',
            attemptedAt: now,
          },
          {
            jobSeekerId: js.id,
            channel: 'whatsapp',
            timeOfDay: 'pm',
            outcome: 'no_pickup',
            attemptedAt: now,
          },
        ],
      });

      // Record 3rd hit by system (simulating the automated daily sweep)
      await jobSeekerService.recordHit(
        js.id,
        'no_pickup',
        'Automated daily no-pickup evaluation',
        'system',
      );

      const historyRes = await request(app.getHttpServer())
        .get(`/status-history?subjectType=job_seeker&subjectId=${js.id}`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);

      const deactivationRow = historyRes.body.find(
        (h: { toStatus: string }) => h.toStatus === 'deactivated',
      );
      expect(deactivationRow).toBeDefined();
      expect(deactivationRow.changedByStaffId).toBeNull();
      expect(deactivationRow.fromStatus).toBe('active');
      expect(deactivationRow.toStatus).toBe('deactivated');
    });
  });

  describe('Atomicity & Data Protection', () => {
    it('rolls back status history if transaction fails', async () => {
      const testId = 'atomicity-test-id';

      await expect(
        prisma.$transaction(async (tx) => {
          await recordStatusChange(tx, {
            subjectType: 'job_seeker',
            subjectId: testId,
            fromStatus: null,
            toStatus: 'active',
            changedByStaffId: ceoStaffId,
          });

          // Throw error inside transaction
          throw new Error('Forced failure to verify atomic rollback');
        }),
      ).rejects.toThrow('Forced failure to verify atomic rollback');

      // Verify no status history row was committed
      const rows = await prisma.statusHistory.findMany({
        where: { subjectId: testId },
      });
      expect(rows).toHaveLength(0);
    });

    it('sanitizes personal data (phone numbers and emails) out of reason', async () => {
      const testId = 'sanitization-test-id';

      await prisma.$transaction(async (tx) => {
        await recordStatusChange(tx, {
          subjectType: 'job_seeker',
          subjectId: testId,
          fromStatus: 'pending',
          toStatus: 'active',
          changedByStaffId: ceoStaffId,
          reason: 'Verified by agent via 9876543210 and agent@example.com contact',
        });
      });

      const row = await prisma.statusHistory.findFirst({
        where: { subjectId: testId },
      });

      expect(row).toBeDefined();
      expect(row?.reason).not.toContain('9876543210');
      expect(row?.reason).not.toContain('agent@example.com');
      expect(row?.reason).toContain('[phone]');
      expect(row?.reason).toContain('[email]');
    });
  });
});
