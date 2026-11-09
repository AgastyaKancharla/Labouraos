import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PricingService } from './pricing.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Pricing & Policy Module (Phase 9 Task 2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jobSeekerService: JobSeekerService;
  let ceoToken: string;
  let managerToken: string;
  let caToken: string;
  let ceoId: string;

  const timestamp = Date.now();
  const password = 'Password123!';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jobSeekerService = app.get<JobSeekerService>(JobSeekerService);

    // Ensure initial seeded row exists in PricingPolicy
    const existingPolicy = await prisma.pricingPolicy.findFirst();
    if (!existingPolicy) {
      await prisma.pricingPolicy.create({
        data: {
          activationFeePaise: 49900,
          placementFeePercent: 50,
          gstPercent: 18,
          referralPayoutPaise: 20000,
          joiningRewardPaise: 20000,
          joiningRewardAfterDays: 30,
          jobSeekerGuaranteeDays: 30,
          offerReplyHours: 48,
          maxHits: 3,
          interviewResultDeadline: '20:00',
          interviewResultEscalateHours: 24,
          placementPaymentDueHours: 24,
          replacementWindowDays: 60,
          replacementSearchDays: 15,
          maxFreeReplacements: 2,
          maxReplacementRejections: 2,
          claimReportDays: 7,
          claimDecisionHours: 48,
          noBypassMonths: 12,
          noBypassPenaltyPercent: 50,
          payoutDetailsCoolingHours: 48,
          idleLogoutMinutes: 60,
          maxSessionMinutes: 120,
          loginCodeValidMinutes: 5,
          failedLoginLimit: 5,
          lockoutMinutes: 15,
          callingHoursStart: '09:00',
          callingHoursEnd: '21:00',
        },
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-PR-${timestamp}`,
        name: 'CEO Pricing',
        email: `ceo_pr_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    ceoId = ceo.id;

    const manager = await prisma.staff.create({
      data: {
        code: `MGR-PR-${timestamp}`,
        name: 'Manager Pricing',
        email: `mgr_pr_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const ca = await prisma.staff.create({
      data: {
        code: `CA-PR-${timestamp}`,
        name: 'Call Agent Pricing',
        email: `ca_pr_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const ceoLogin = await enrolledLogin(app.getHttpServer(), { email: ceo.email, password })
      .expect(200);
    ceoToken = ceoLogin.body.accessToken;

    const mgrLogin = await enrolledLogin(app.getHttpServer(), { email: manager.email, password })
      .expect(200);
    managerToken = mgrLogin.body.accessToken;

    const caLogin = await enrolledLogin(app.getHttpServer(), { email: ca.email, password })
      .expect(200);
    caToken = caLogin.body.accessToken;
  });

  const createdPaymentCodes: string[] = [];
  const createdPaymentIds: string[] = [];
  const createdJobSeekerIds: string[] = [];

  afterAll(async () => {
    if (prisma) {
      if (createdPaymentIds.length > 0) {
        await prisma.payment.deleteMany({
          where: { id: { in: createdPaymentIds } },
        });
      }
      if (createdPaymentCodes.length > 0) {
        await prisma.payment.deleteMany({
          where: { code: { in: createdPaymentCodes } },
        });
      }
      if (createdJobSeekerIds.length > 0) {
        await prisma.jobSeeker.deleteMany({
          where: { id: { in: createdJobSeekerIds } },
        });
      }
      // Reset PricingPolicy so subsequent test suites see the default seeded policy
      await prisma.pricingPolicy.deleteMany({
        where: {
          id: { not: '00000000-0000-0000-0000-000000000001' },
        },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('allows CEO and Manager to read pricing & policy (GET /pricing)', async () => {
    const resCeo = await request(app.getHttpServer())
      .get('/pricing')
      .set('Authorization', `Bearer ${ceoToken}`)
      .expect(200);

    expect(resCeo.body.activationFeePaise).toBe(49900);
    expect(resCeo.body.placementFeePercent).toBe(50);
    expect(resCeo.body.gstPercent).toBe(18);
    expect(resCeo.body.referralPayoutPaise).toBe(20000);
    expect(resCeo.body.maxHits).toBe(3);
    expect(resCeo.body.maxReplacementRejections).toBe(2);
    expect(resCeo.body.jobSeekerGuaranteeDays).toBe(30);
    expect(resCeo.body.replacementWindowDays).toBe(60);
    expect(resCeo.body.replacementSearchDays).toBe(15);

    const resMgr = await request(app.getHttpServer())
      .get('/pricing')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(resMgr.body.activationFeePaise).toBe(49900);
  });

  it('denies Call Agent reading pricing (GET /pricing -> 403 Forbidden)', async () => {
    await request(app.getHttpServer())
      .get('/pricing')
      .set('Authorization', `Bearer ${caToken}`)
      .expect(403);
  });

  it('denies Manager updating pricing via PUT /pricing (403 Forbidden)', async () => {
    await request(app.getHttpServer())
      .put('/pricing')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        activationFeePaise: 59900,
      })
      .expect(403);
  });

  it('denies Manager updating pricing via POST /pricing (403 Forbidden)', async () => {
    await request(app.getHttpServer())
      .post('/pricing')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        referralPayoutPaise: 25000,
      })
      .expect(403);
  });

  it('allows CEO to update pricing & policy via PUT /pricing, inserting a new version without editing old row', async () => {
    const countBefore = await prisma.pricingPolicy.count();

    const putRes = await request(app.getHttpServer())
      .put('/pricing')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        referralPayoutPaise: 25000,
        replacementSearchDays: 15,
      })
      .expect(200);

    expect(putRes.body.referralPayoutPaise).toBe(25000);
    expect(putRes.body.replacementSearchDays).toBe(15);

    const countAfter = await prisma.pricingPolicy.count();
    expect(countAfter).toBe(countBefore + 1);

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'pricing',
        action: 'pricing_change',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeDefined();
    expect(audit?.action).toBe('pricing_change');
  });

  it('changing activation fee changes the next activation charge and not an earlier one', async () => {
    // 1. Reset policy to 49900
    await request(app.getHttpServer())
      .put('/pricing')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ activationFeePaise: 49900 })
      .expect(200);

    // 2. Create job seeker 1 at 49900
    const js1 = await prisma.jobSeeker.create({
      data: {
        code: `JS-PR1-${Date.now()}`,
        name: 'Candidate 1',
        phone: `+9199991${Math.floor(Math.random() * 90000 + 10000)}`,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'pending_activation',
        city: 'Bengaluru',
      },
    });
    createdJobSeekerIds.push(js1.id);

    const charge1 = await jobSeekerService.createActivationPayment(js1.id);
    expect(charge1.amount).toBe(49900);
    if (charge1.paymentId) createdPaymentIds.push(charge1.paymentId);

    // 3. CEO changes activation fee to 59900
    await request(app.getHttpServer())
      .put('/pricing')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({ activationFeePaise: 59900 })
      .expect(200);

    // 4. Create job seeker 2 at 59900
    const js2 = await prisma.jobSeeker.create({
      data: {
        code: `JS-PR2-${Date.now()}`,
        name: 'Candidate 2',
        phone: `+9199992${Math.floor(Math.random() * 90000 + 10000)}`,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'pending_activation',
        city: 'Bengaluru',
      },
    });
    createdJobSeekerIds.push(js2.id);

    const charge2 = await jobSeekerService.createActivationPayment(js2.id);
    expect(charge2.amount).toBe(59900);
    if (charge2.paymentId) createdPaymentIds.push(charge2.paymentId);

    // 5. Earlier payment on js1 is unchanged
    const p1 = await prisma.payment.findUnique({ where: { id: charge1.paymentId } });
    expect(p1?.amount).toBe(49900);
  });

  it('a refund after a price change returns the original amount paid', async () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    const paymentReceivedAt = new Date('2026-06-01T10:00:00.000Z'); // >30 days ago

    // Candidate A paid 49900
    const jsA = await prisma.jobSeeker.create({
      data: {
        code: `JS-RFA-${Date.now()}`,
        name: 'Candidate A',
        phone: `+9199993${Math.floor(Math.random() * 90000 + 10000)}`,
        trades: { create: { trade: 'Plumber', isPrimary: true } },
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt,
        city: 'Bengaluru',
      },
    });
    createdJobSeekerIds.push(jsA.id);

    const payCodeA = `PAY-${Math.floor(Math.random() * 90000 + 10000)}`;
    createdPaymentCodes.push(payCodeA);

    await prisma.payment.create({
      data: {
        code: payCodeA,
        city: 'Bengaluru',
        type: 'activation',
        amount: 49900,
        status: 'completed',
        gatewayReference: `gw_ref_a_${Date.now()}`,
        subjectType: 'job_seeker',
        subjectId: jsA.id,
        jobSeekerId: jsA.id,
        createdAt: paymentReceivedAt,
      },
    });

    // Current price is 59900 (from previous test)
    // Approve refund for jsA: should refund 49900 (the amount actually paid)
    const refundA = await jobSeekerService.approveRefund(jsA.id, { asOf: now.toISOString() }, ceoId);
    expect(refundA.amount).toBe(49900);
    if (refundA.code) createdPaymentCodes.push(refundA.code);

    // Candidate B paid 59900
    const jsB = await prisma.jobSeeker.create({
      data: {
        code: `JS-RFB-${Date.now()}`,
        name: 'Candidate B',
        phone: `+9199994${Math.floor(Math.random() * 90000 + 10000)}`,
        trades: { create: { trade: 'Plumber', isPrimary: true } },
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt,
        city: 'Bengaluru',
      },
    });
    createdJobSeekerIds.push(jsB.id);

    const payCodeB = `PAY-${Math.floor(Math.random() * 90000 + 10000)}`;
    createdPaymentCodes.push(payCodeB);

    await prisma.payment.create({
      data: {
        code: payCodeB,
        city: 'Bengaluru',
        type: 'activation',
        amount: 59900,
        status: 'completed',
        gatewayReference: `gw_ref_b_${Date.now()}`,
        subjectType: 'job_seeker',
        subjectId: jsB.id,
        jobSeekerId: jsB.id,
        createdAt: paymentReceivedAt,
      },
    });

    // Approve refund for jsB: should refund 59900 (the amount actually paid)
    const refundB = await jobSeekerService.approveRefund(jsB.id, { asOf: now.toISOString() }, ceoId);
    expect(refundB.amount).toBe(59900);
    if (refundB.code) createdPaymentCodes.push(refundB.code);
  });

  it('a new PricingService instance (simulating a restart) sees the changed values', async () => {
    const auditService = app.get<AuditService>(AuditService);
    const newServiceInstance = new PricingService(prisma, auditService);

    const current = await newServiceInstance.current();
    expect(current.activationFeePaise).toBe(59900);
  });
});
