import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Referral Registration (Phase 2 Task 3)', () => {
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

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-RF-${timestamp}`,
        name: 'Call Agent RF',
        email: `call_agent_rf_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id;

    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-RF-${timestamp}`,
        name: 'Field Agent RF',
        email: `field_agent_rf_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });
    fieldAgentId = fieldAgent.id;

    const finance = await prisma.staff.create({
      data: {
        code: `FI-RF-${timestamp}`,
        name: 'Finance RF',
        email: `finance_rf_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    financeId = finance.id;

    const server = app.getHttpServer();

    const caRes = await enrolledLogin(server, { email: callAgent.email, password });
    callAgentToken = caRes.body.accessToken;

    const faRes = await enrolledLogin(server, { email: fieldAgent.email, password });
    fieldAgentToken = faRes.body.accessToken;

    const fiRes = await enrolledLogin(server, { email: finance.email, password });
    financeToken = fiRes.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          actorId: { in: [callAgentId, fieldAgentId, financeId] },
        },
      });
      await prisma.jobSeeker.deleteMany({
        where: {
          phone: { contains: `${timestamp.toString().slice(-8)}` },
        },
      });
      await prisma.referral.deleteMany({
        where: {
          phone: { contains: `${timestamp.toString().slice(-8)}` },
        },
      });
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

  it('allows call_agent to register a referral with verified OTP', async () => {
    const phone = `81${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Rajesh Sharma',
        phone,
        type: 'individual',
        otpRequestId,
        city: 'Bengaluru',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^RF-\d{5}$/);
    expect(res.body.name).toBe('Rajesh Sharma');
    expect(res.body.phoneVerified).toBe(true);
    expect(res.body.type).toBe('individual');

    // Audit log check
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityCode: res.body.code,
        action: 'referral.create',
      },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].actorId).toBe(callAgentId);
  });

  it('allows registering a business-type referral', async () => {
    const phone = `82${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Sharma Staffing Services',
        phone,
        type: 'business',
        otpRequestId,
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('business');
  });

  it('rejects referral with invalid type (400)', async () => {
    const phone = `83${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Sharma Agency',
        phone,
        type: 'agency', // Invalid type
        otpRequestId,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('type');
  });

  it('denies field_agent and finance from creating a referral (403)', async () => {
    const phone = `84${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const faRes = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({
        name: 'FA Referral',
        phone,
        type: 'individual',
        otpRequestId,
      });
    expect(faRes.status).toBe(403);

    const fiRes = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        name: 'Finance Referral',
        phone,
        type: 'individual',
        otpRequestId,
      });
    expect(fiRes.status).toBe(403);
  });

  it('rejects referral creation without verified OTP (400)', async () => {
    const phone = `85${timestamp.toString().slice(-8)}`;
    const { requestId } = await otpService.sendOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Unverified Referral',
        phone,
        type: 'individual',
        otpRequestId: requestId,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('OTP');
  });

  it('validates referredById when creating a job seeker: rejects invalid and links valid', async () => {
    // 1. Create a valid referral
    const referralPhone = `86${timestamp.toString().slice(-8)}`;
    const refOtpId = await getVerifiedOtp(referralPhone);
    const refRes = await request(app.getHttpServer())
      .post('/referrals')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Referral Partner John',
        phone: referralPhone,
        type: 'individual',
        otpRequestId: refOtpId,
      });
    const referralId = refRes.body.id;

    // 2. Attempt to create a job seeker with non-existent referredById -> 400
    const jsPhone1 = `87${timestamp.toString().slice(-8)}`;
    const jsOtp1 = await getVerifiedOtp(jsPhone1);
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    const failRes = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        phone: jsPhone1,
        otpRequestId: jsOtp1,
        tradeSkill: 'Painter',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '17:00',
        referredById: nonExistentId,
      });

    expect(failRes.status).toBe(400);
    expect(failRes.body.message).toContain('Referral partner');

    // 3. Create a job seeker with valid referredById -> 201
    const jsPhone2 = `88${timestamp.toString().slice(-8)}`;
    const jsOtp2 = await getVerifiedOtp(jsPhone2);

    const successRes = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        phone: jsPhone2,
        otpRequestId: jsOtp2,
        tradeSkill: 'Painter',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '17:00',
        referredById: referralId,
      });

    expect(successRes.status).toBe(201);
    expect(successRes.body.referredById).toBe(referralId);

    // Verify relation from referral side
    const refWithSeekers = await prisma.referral.findUnique({
      where: { id: referralId },
      include: { jobSeekers: true },
    });
    expect(refWithSeekers?.jobSeekers).toHaveLength(1);
    expect(refWithSeekers?.jobSeekers[0].id).toBe(successRes.body.id);
  });
});
