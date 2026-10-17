import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';

describe('Job Seeker Registration (Phase 2 Task 2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let callAgentToken: string;
  let callAgentId: string;
  let fieldAgentToken: string;
  let fieldAgentId: string;
  let financeToken: string;
  let financeId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    otpService = app.get<OtpService>(OtpService);

    const passwordHash = await bcrypt.hash(password, 10);

    // Create Call Agent
    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-JS-${timestamp}`,
        name: 'Call Agent JS',
        email: `call_agent_js_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id;

    // Create Field Agent
    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-JS-${timestamp}`,
        name: 'Field Agent JS',
        email: `field_agent_js_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });
    fieldAgentId = fieldAgent.id;

    // Create Finance User
    const finance = await prisma.staff.create({
      data: {
        code: `FI-JS-${timestamp}`,
        name: 'Finance JS',
        email: `finance_js_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    financeId = finance.id;

    const server = app.getHttpServer();

    // Login Call Agent
    const caRes = await request(server)
      .post('/auth/login')
      .send({ email: callAgent.email, password });
    callAgentToken = caRes.body.accessToken;

    // Login Field Agent
    const faRes = await request(server)
      .post('/auth/login')
      .send({ email: fieldAgent.email, password });
    fieldAgentToken = faRes.body.accessToken;

    // Login Finance
    const fiRes = await request(server)
      .post('/auth/login')
      .send({ email: finance.email, password });
    financeToken = fiRes.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      // Clean up audit logs for our test actors
      await prisma.auditLog.deleteMany({
        where: {
          actorId: { in: [callAgentId, fieldAgentId, financeId] },
        },
      });
      // Delete test job seekers created during this suite
      await prisma.jobSeeker.deleteMany({
        where: {
          phone: { contains: `${timestamp.toString().slice(-8)}` },
        },
      });
      // Delete test staff
      await prisma.staff.deleteMany({
        where: {
          id: { in: [callAgentId, fieldAgentId, financeId] },
        },
      });
    }
    if (app) {
      await app.close();
    }
  });

  async function getVerifiedOtp(phone: string): Promise<string> {
    const { requestId } = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const code = mockProvider.getCode(requestId)!;
    await otpService.verifyOtp(requestId, code);
    return requestId;
  }

  it('allows a call_agent token to register a job seeker with verified OTP', async () => {
    const phone = `91${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        phone,
        otpRequestId,
        tradeSkill: 'Electrician',
        minSalary: 2000000, // ₹20,000 in paise
        maxSalary: 2500000, // ₹25,000 in paise
        preferredCallWindowStart: '09:30',
        preferredCallWindowEnd: '18:00',
        city: 'Bengaluru',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^JS-\d{5}$/);
    expect(res.body.status).toBe('pending_payment');
    expect(res.body.phoneVerified).toBe(true);
    expect(res.body.tradeSkill).toBe('Electrician');
    expect(res.body.minSalary).toBe(2000000);
    expect(res.body.maxSalary).toBe(2500000);
    expect(res.body.preferredCallWindowStart).toBe('09:30');
    expect(res.body.preferredCallWindowEnd).toBe('18:00');

    // Verify audit log entry was created
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityCode: res.body.code,
        action: 'job_seeker.create',
      },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].actorId).toBe(callAgentId);
  });

  it('denies a field_agent token from creating a job seeker (403)', async () => {
    const phone = `92${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({
        phone,
        otpRequestId,
        tradeSkill: 'Driver',
        minSalary: 1800000,
        maxSalary: 2200000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '17:00',
      });

    expect(res.status).toBe(403);
  });

  it('denies a finance token from creating a job seeker (403)', async () => {
    const phone = `93${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        phone,
        otpRequestId,
        tradeSkill: 'Plumber',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '17:00',
      });

    expect(res.status).toBe(403);
  });

  it('rejects registration without OTP verification (400)', async () => {
    const phone = `94${timestamp.toString().slice(-8)}`;
    // Unverified OTP
    const { requestId } = await otpService.sendOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        phone,
        otpRequestId: requestId,
        tradeSkill: 'Carpenter',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('OTP');
  });

  it('rejects registration with preferredCallWindow outside 09:00–21:00 IST (400)', async () => {
    const phone = `95${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    // Too early: 08:30
    const resEarly = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        phone,
        otpRequestId,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 2500000,
        preferredCallWindowStart: '08:30',
        preferredCallWindowEnd: '18:00',
      });

    expect(resEarly.status).toBe(400);
    expect(resEarly.body.message).toContain('09:00–21:00');

    // Too late: 21:30
    const resLate = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        phone,
        otpRequestId,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 2500000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '21:30',
      });

    expect(resLate.status).toBe(400);
    expect(resLate.body.message).toContain('09:00–21:00');
  });

  it('rejects registration when minSalary > maxSalary or non-integers (400)', async () => {
    const phone = `96${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    // minSalary > maxSalary
    const resInverted = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        phone,
        otpRequestId,
        tradeSkill: 'Painter',
        minSalary: 3000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
      });

    expect(resInverted.status).toBe(400);
    expect(resInverted.body.message).toContain('minSalary');

    // Floating point money
    const resFloat = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        phone,
        otpRequestId,
        tradeSkill: 'Painter',
        minSalary: 20000.5,
        maxSalary: 25000.5,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
      });

    expect(resFloat.status).toBe(400);
    expect(resFloat.body.message).toContain('integer');
  });

  it('rejects registration if raw Aadhaar is submitted under any field name (400)', async () => {
    const phone = `97${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        phone,
        otpRequestId,
        tradeSkill: 'Driver',
        minSalary: 2000000,
        maxSalary: 2500000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        aadhaarNumber: '123456789012',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Aadhaar');
  });

  it('GET /job-seekers/:id returns refund guarantee deadline and eligibility', async () => {
    // 1. Pending seeker without payment
    const phone1 = `98${timestamp.toString().slice(-8)}`;
    const otpRequestId1 = await getVerifiedOtp(phone1);

    const createRes = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Pending Seeker',
        phone: phone1,
        otpRequestId: otpRequestId1,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      });
    const pendingId = createRes.body.id;

    const getPendingRes = await request(app.getHttpServer())
      .get(`/job-seekers/${pendingId}`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(getPendingRes.status).toBe(200);
    expect(getPendingRes.body.refundGuaranteeDeadline).toBeNull();
    expect(getPendingRes.body.isWithinRefundGuarantee).toBe(false);

    // 2. Active seeker with payment received
    const paymentTime = new Date('2026-06-01T10:00:00.000Z');
    await prisma.jobSeeker.update({
      where: { id: pendingId },
      data: {
        status: 'active',
        paymentReceivedAt: paymentTime,
      },
    });

    const getActiveRes = await request(app.getHttpServer())
      .get(`/job-seekers/${pendingId}`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(getActiveRes.status).toBe(200);
    expect(getActiveRes.body.refundGuaranteeDeadline).toBe('2026-07-01T10:00:00.000Z');
  });
});
