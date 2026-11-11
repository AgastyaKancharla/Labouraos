import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { completeJobSeekerRegistration } from '../../test-support/job-seeker-registration';

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
    const caRes = await enrolledLogin(server, { email: callAgent.email, password });
    callAgentToken = caRes.body.accessToken;

    // Login Field Agent
    const faRes = await enrolledLogin(server, { email: fieldAgent.email, password });
    fieldAgentToken = faRes.body.accessToken;

    // Login Finance
    const fiRes = await enrolledLogin(server, { email: finance.email, password });
    financeToken = fiRes.body.accessToken;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const testSeekers = await prisma.jobSeeker.findMany({
          where: { phone: { contains: `${timestamp.toString().slice(-8)}` } },
          select: { id: true },
        });
        await prisma.tradeSuggestionSubject.deleteMany({
          where: { subjectType: 'job_seeker', subjectId: { in: testSeekers.map(({ id }) => id) } },
        });
        await prisma.tradeSuggestion.deleteMany({ where: { typedName: `Specialist-${timestamp}` } });
        await prisma.auditLog.deleteMany({
          where: { actorId: { in: [callAgentId, fieldAgentId, financeId] } },
        });
        await prisma.jobSeeker.deleteMany({
          where: { phone: { contains: `${timestamp.toString().slice(-8)}` } },
        });
        await prisma.staff.deleteMany({ where: { id: { in: [callAgentId, fieldAgentId, financeId] } } });
      }
    } finally {
      if (app) await app.close();
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
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId,
        tradeSkill: 'Electrician',
        minSalary: 2000000, // ₹20,000 in paise
        maxSalary: 2500000, // ₹25,000 in paise
        preferredCallWindowStart: '09:30',
        preferredCallWindowEnd: '18:00',
        city: 'Bengaluru',
      }));

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^JS-\d{5}$/);
    expect(res.body.status).toBe('lead');
    expect(res.body.phoneVerified).toBe(true);
    expect(res.body.tradeSkill).toBe('Electrician');
    expect(res.body.minSalary).toBe(2000000);
    expect(res.body.maxSalary).toBe(2500000);
    expect(res.body.preferredCallWindowStart).toBe('09:00');
    expect(res.body.preferredCallWindowEnd).toBe('21:00');

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

  it('does not let one verified OTP request create two job seekers', async () => {
    const phone = `9${timestamp.toString().slice(-8)}3`;
    const otpRequestId = await getVerifiedOtp(phone);
    const payload = completeJobSeekerRegistration({
      phone,
      otpRequestId,
      tradeSkill: 'Cook',
      minSalary: 1800000,
      maxSalary: 2400000,
      preferredCallWindowStart: '09:30',
      preferredCallWindowEnd: '18:00',
      city: 'Bengaluru',
    });

    await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(payload)
      .expect(201);
    await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(payload)
      .expect(400);
    expect(await prisma.jobSeeker.count({ where: { phone: `+91${phone}` } })).toBe(1);
  });

  it('saves an Other trade immediately and queues a distinct suggestion', async () => {
    const phone = `9${timestamp.toString().slice(-8)}2`;
    const otpRequestId = await getVerifiedOtp(phone);
    const tradeName = `Specialist-${timestamp}`;
    const response = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId,
        tradeSkill: tradeName,
        minSalary: 2000000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:30',
        preferredCallWindowEnd: '18:00',
        city: 'Bengaluru',
      }))
      .expect(201);

    expect(response.body.tradeSkill).toBe(tradeName);
    expect(response.body.guaranteeFloorPaise).toBeNull();
    expect(response.body.warnings).toEqual([]);
    expect(await prisma.jobSeekerTrade.count({ where: { jobSeekerId: response.body.id, trade: tradeName } })).toBe(1);
    const suggestion = await prisma.tradeSuggestion.findUnique({ where: { typedNameKey: tradeName.toLocaleLowerCase('en-IN') } });
    expect(suggestion).toMatchObject({
      typedName: tradeName,
      status: 'waiting',
      subjectType: 'job_seeker',
      subjectId: response.body.id,
    });
  });

  it('returns the market warning and stores the lower salary guarantee floor', async () => {
    const phone = `9${timestamp.toString().slice(-8)}4`;
    const otpRequestId = await getVerifiedOtp(phone);
    const response = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        name: 'Above Market Candidate',
        phone,
        otpRequestId,
        trades: [
          { trade: 'Housekeeping', yearsExperience: 3 },
          { trade: 'Cook', yearsExperience: 1 },
        ],
        minSalary: 2500000,
        maxSalary: 3000000,
        spokenLanguages: ['Kannada', 'Hindi'],
      }))
      .expect(201);

    expect(response.body.warnings).toEqual(['salary_above_market']);
    expect(response.body.salaryRange).toEqual({ minSalaryPaise: 1600000, maxSalaryPaise: 2300000 });
    expect(response.body.guaranteeFloorPaise).toBe(2300000);
    expect(response.body.status).toBe('lead');
    expect(await prisma.jobSeekerTrade.count({ where: { jobSeekerId: response.body.id } })).toBe(2);
    expect(await prisma.jobSeekerLanguage.findMany({ where: { jobSeekerId: response.body.id } })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ language: 'Kannada', speaks: true, reads: false, writes: false }),
        expect.objectContaining({ language: 'Hindi', speaks: true, reads: false, writes: false }),
      ]),
    );
  });

  it('leaves the guarantee floor unset for an unlisted primary trade until it is managed', async () => {
    const phone = `9${timestamp.toString().slice(-8)}6`;
    const otpRequestId = await getVerifiedOtp(phone);
    const response = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        name: 'Other Trade Candidate',
        phone,
        otpRequestId,
        trades: [{ trade: 'Special Cook', yearsExperience: 2 }],
        minSalary: 2500000,
        maxSalary: 3000000,
      }))
      .expect(201);

    expect(response.body.guaranteeFloorPaise).toBeNull();
    expect(response.body.warnings).toEqual([]);
    expect(response.body.salaryRange).toBeUndefined();
    expect(await prisma.jobSeekerTrade.count({ where: { jobSeekerId: response.body.id, trade: 'Special Cook' } })).toBe(1);
    expect(await prisma.tradeSuggestionSubject.count({
      where: { subjectType: 'job_seeker', subjectId: response.body.id },
    })).toBe(1);
  });

  it.each([
    ['name', { name: '' }, 'name is required'],
    ['message language', { messageLanguage: 'ta' }, 'messageLanguage'],
    ['call window', { bestTimeToCall: '08-12' }, 'bestTimeToCall'],
    ['date of birth', { dateOfBirth: '2010-01-01' }, 'at least 18'],
    ['gender', { gender: '' }, 'gender is required'],
    ['heard-from source', { heardFrom: 'unknown' }, 'heardFrom'],
    ['location pin', { longitude: 181 }, 'longitude'],
    ['travel distance', { travelDistanceKm: 0 }, 'travelDistanceKm'],
    ['trade list', { trades: [] }, 'One to three trades'],
    ['availability date', { availableFrom: 'invalid' }, 'availableFrom'],
    ['salary range', { minSalary: 3000000, maxSalary: 2000000 }, 'minSalary'],
    ['shift preference', { shiftPreference: 'evening' }, 'shiftPreference'],
    ['job type', { jobType: 'contract' }, 'jobType'],
    ['spoken languages', { spokenLanguages: [] }, 'spoken language'],
  ])('enforces required registration field group: %s', async (_group, changes, message) => {
    const response = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone: `9${timestamp.toString().slice(-8)}5`,
        otpRequestId: 'unused-validation-only',
        ...changes,
      }));
    expect(response.status).toBe(400);
    expect(response.body.message).toContain(message);
  });

  it('returns the migration-seeded managed trades with salary ranges and minimum wages', async () => {
    const response = await request(app.getHttpServer())
      .get('/trades')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(200);

    expect(response.body).toHaveLength(16);
    expect(response.body[0]).toMatchObject({
      name: 'Housekeeping',
      salaryMinPaise: 1600000,
      salaryMaxPaise: 2300000,
      minimumWageLevel: 'unskilled',
      legalMinimumPaise: 2337600,
    });
    expect(response.body[0].effectiveFrom).toContain('2026-05-22');
  });

  it('allows a field_agent token to create a job seeker (201)', async () => {
    const phone = `92${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId,
        tradeSkill: 'Driver',
        minSalary: 1800000,
        maxSalary: 2200000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '17:00',
      }));

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('denies a finance token from creating a job seeker (403)', async () => {
    const phone = `93${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${financeToken}`)
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId,
        tradeSkill: 'Plumber',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '17:00',
      }));

    expect(res.status).toBe(403);
  });

  it('rejects registration without OTP verification (400)', async () => {
    const phone = `94${timestamp.toString().slice(-8)}`;
    // Unverified OTP
    const { requestId } = await otpService.sendOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId: requestId,
        tradeSkill: 'Carpenter',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
      }));

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
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 2500000,
        bestTimeToCall: 'invalid',
      }));

    expect(resEarly.status).toBe(400);
    expect(resEarly.body.message).toContain('bestTimeToCall');

    // Too late: 21:30
    const resLate = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 2500000,
        bestTimeToCall: 'invalid',
      }));

    expect(resLate.status).toBe(400);
    expect(resLate.body.message).toContain('bestTimeToCall');
  });

  it('rejects registration when minSalary > maxSalary or non-integers (400)', async () => {
    const phone = `96${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    // minSalary > maxSalary
    const resInverted = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId,
        tradeSkill: 'Painter',
        minSalary: 3000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
      }));

    expect(resInverted.status).toBe(400);
    expect(resInverted.body.message).toContain('minSalary');

    // Floating point money
    const resFloat = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId,
        tradeSkill: 'Painter',
        minSalary: 20000.5,
        maxSalary: 25000.5,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
      }));

    expect(resFloat.status).toBe(400);
    expect(resFloat.body.message).toContain('integer');
  });

  it('rejects registration if raw Aadhaar is submitted under any field name (400)', async () => {
    const phone = `97${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send(completeJobSeekerRegistration({
        phone,
        otpRequestId,
        tradeSkill: 'Driver',
        minSalary: 2000000,
        maxSalary: 2500000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        aadhaarNumber: '123456789012',
      }));

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
      .send(completeJobSeekerRegistration({
        name: 'Pending Seeker',
        phone: phone1,
        otpRequestId: otpRequestId1,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      }));
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
