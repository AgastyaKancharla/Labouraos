import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 3 Task 5: Reactivation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let callAgentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;

  let activeJobSeekerId: string;
  let deactivatedJobSeekerId: string;
  let deactivatedJobSeekerCode: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  // Old payment 40 days ago (so original 30-day window had already expired)
  const oldPaymentDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-REACT-${timestamp}`,
        name: 'Call Agent React',
        email: `ca_react_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-REACT-${timestamp}`,
        name: 'Field Agent React',
        email: `fa_react_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });

    const finance = await prisma.staff.create({
      data: {
        code: `FI-REACT-${timestamp}`,
        name: 'Finance React',
        email: `fi_react_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    callAgentToken = await login(callAgent.email);
    fieldAgentToken = await login(fieldAgent.email);
    financeToken = await login(finance.email);

    // Create an active job seeker
    const activeJs = await prisma.jobSeeker.create({
      data: {
        code: `JS-ACT-${timestamp}`,
        name: 'Active Worker',
        phone: `96${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Welder',
        minSalary: 1800000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 1,
        city: 'Bengaluru',
      },
    });
    activeJobSeekerId = activeJs.id;

    // Create a deactivated job seeker with 3 hits and an old payment (40 days ago)
    deactivatedJobSeekerCode = `JS-DEACT-${timestamp}`;
    const deactivatedJs = await prisma.jobSeeker.create({
      data: {
        code: deactivatedJobSeekerCode,
        name: 'Deactivated Worker',
        phone: `97${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Plumber',
        minSalary: 1600000,
        maxSalary: 2400000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'deactivated',
        hitCount: 3,
        paymentReceivedAt: oldPaymentDate,
        city: 'Bengaluru',
      },
    });
    deactivatedJobSeekerId = deactivatedJs.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.payment.deleteMany({
        where: { jobSeekerId: { in: [activeJobSeekerId, deactivatedJobSeekerId] } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityCode: deactivatedJobSeekerCode },
      });
      await prisma.jobSeeker.deleteMany({
        where: { id: { in: [activeJobSeekerId, deactivatedJobSeekerId] } },
      });
      await prisma.staff.deleteMany({
        where: { code: { in: [`CA-REACT-${timestamp}`, `FA-REACT-${timestamp}`, `FI-REACT-${timestamp}`] } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('rejects POST /job-seekers/:id/reactivate on an active job seeker with 400 Bad Request', async () => {
    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${activeJobSeekerId}/reactivate`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('must be deactivated to be reactivated');
  });

  it('field_agent and finance roles are denied POST /job-seekers/:id/reactivate with 403 Forbidden', async () => {
    const faRes = await request(app.getHttpServer())
      .post(`/job-seekers/${deactivatedJobSeekerId}/reactivate`)
      .set('Authorization', `Bearer ${fieldAgentToken}`);
    expect(faRes.status).toBe(403);

    const fiRes = await request(app.getHttpServer())
      .post(`/job-seekers/${deactivatedJobSeekerId}/reactivate`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(fiRes.status).toBe(403);
  });

  it('triggers a fresh ₹499 activation payment with reactivation: true for a deactivated job seeker', async () => {
    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${deactivatedJobSeekerId}/reactivate`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(res.status).toBe(201);
    expect(res.body.paymentId).toBeDefined();
    expect(res.body.paymentCode).toMatch(/^PAY-\d{5}$/);
    expect(res.body.amount).toBe(49900); // ₹499 in paise
    expect(res.body.reactivation).toBe(true);
    expect(res.body.status).toBe('pending');
    expect(res.body.paymentLink).toBeDefined();
    expect(res.body.gatewayReference).toBeDefined();

    // Verify row in database
    const payment = await prisma.payment.findUnique({
      where: { id: res.body.paymentId },
    });
    expect(payment).toBeDefined();
    expect(payment?.amount).toBe(49900);
    expect(payment?.reactivation).toBe(true);
    expect(payment?.status).toBe('pending');
    expect(payment?.type).toBe('activation');

    // Verify audit log for reactivation initiation
    const initAudit = await prisma.auditLog.findFirst({
      where: {
        entityCode: deactivatedJobSeekerCode,
        action: 'job_seeker.reactivation_initiated',
      },
    });
    expect(initAudit).toBeDefined();
  });

  it('on webhook success: hitCount resets to 0, status -> active, and 30-day refund clock restarts from new payment', async () => {
    const beforeWebhookTime = new Date();

    // Initiate reactivation to get gateway reference
    const reactivateRes = await request(app.getHttpServer())
      .post(`/job-seekers/${deactivatedJobSeekerId}/reactivate`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    const { gatewayReference, paymentId } = reactivateRes.body;

    // Simulate webhook arrival
    const webhookRes = await request(app.getHttpServer())
      .post('/payments/webhook')
      .send({
        gatewayReference,
        status: 'succeeded',
        amountPaise: 49900,
      });

    expect(webhookRes.status).toBe(201);
    expect(webhookRes.body.received).toBe(true);
    expect(webhookRes.body.status).toBe('succeeded');

    // 1. Payment status is succeeded
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    expect(payment?.status).toBe('succeeded');

    // 2. Job seeker in DB: status is active, hitCount is 0, paymentReceivedAt is updated
    const jsInDb = await prisma.jobSeeker.findUnique({
      where: { id: deactivatedJobSeekerId },
    });
    expect(jsInDb?.status).toBe('active');
    expect(jsInDb?.hitCount).toBe(0);
    expect(jsInDb?.paymentReceivedAt).toBeDefined();
    const newPaymentReceivedAt = new Date(jsInDb!.paymentReceivedAt!);
    expect(newPaymentReceivedAt.getTime()).toBeGreaterThanOrEqual(beforeWebhookTime.getTime());
    // Crucially: it must NOT be the old payment date (40 days ago)
    expect(newPaymentReceivedAt.getTime()).toBeGreaterThan(oldPaymentDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 3. GET /job-seekers/:id reflects active, hitCount 0, and refund guarantee is active (deadline 30 days from NEW payment)
    const getRes = await request(app.getHttpServer())
      .get(`/job-seekers/${deactivatedJobSeekerId}`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe('active');
    expect(getRes.body.hitCount).toBe(0);
    expect(getRes.body.isWithinRefundGuarantee).toBe(true);

    const expectedDeadline = new Date(newPaymentReceivedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const actualDeadline = new Date(getRes.body.refundGuaranteeDeadline);
    expect(Math.abs(actualDeadline.getTime() - expectedDeadline.getTime())).toBeLessThan(1000);

    // 4. Audit log entry for reactivation
    const reactivatedAudit = await prisma.auditLog.findFirst({
      where: {
        entityCode: deactivatedJobSeekerCode,
        action: 'job_seeker.reactivated',
      },
    });
    expect(reactivatedAudit).toBeDefined();
    expect((reactivatedAudit?.before as Record<string, unknown>)?.status).toBe('deactivated');
    expect((reactivatedAudit?.before as Record<string, unknown>)?.hitCount).toBe(3);
    expect((reactivatedAudit?.after as Record<string, unknown>)?.status).toBe('active');
    expect((reactivatedAudit?.after as Record<string, unknown>)?.hitCount).toBe(0);
  });
});
