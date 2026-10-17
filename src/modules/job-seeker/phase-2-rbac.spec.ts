import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Phase 2 Task 8: RBAC, PII Masking, and Field Agent Denial', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let financeToken: string;
  let financeId: string;
  let fieldAgentToken: string;
  let fieldAgentId: string;
  let callAgentToken: string;
  let callAgentId: string;
  let ceoToken: string;
  let ceoId: string;

  let testJobSeekerId: string;
  let testReferralId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const testPhone = `90${timestamp.toString().slice(-8)}`;
  const testKycRef = `KYC-SECRET-REF-${timestamp}`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    // Create staff members
    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-T8-${timestamp}`,
        name: 'CEO T8',
        email: `ceo_t8_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    ceoId = ceo.id;

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-T8-${timestamp}`,
        name: 'Call Agent T8',
        email: `ca_t8_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id;

    const fieldAgent = await prisma.staff.create({
      data: {
        code: `FA-T8-${timestamp}`,
        name: 'Field Agent T8',
        email: `fa_t8_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });
    fieldAgentId = fieldAgent.id;

    const finance = await prisma.staff.create({
      data: {
        code: `FI-T8-${timestamp}`,
        name: 'Finance T8',
        email: `fi_t8_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    financeId = finance.id;

    // Login tokens
    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await request(server).post('/auth/login').send({ email, password });
      return res.body.accessToken;
    };

    ceoToken = await login(ceo.email);
    callAgentToken = await login(callAgent.email);
    fieldAgentToken = await login(fieldAgent.email);
    financeToken = await login(finance.email);

    // Seed test referral
    const referral = await prisma.referral.create({
      data: {
        code: `RF-T8-${timestamp}`,
        name: 'Partner Ramesh',
        phone: `89${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });
    testReferralId = referral.id;

    // Seed test job seeker with sensitive KYC reference and phone
    const jobSeeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-T8-${timestamp}`,
        name: 'Ramesh Seeker',
        phone: testPhone,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        kycStatus: 'verified',
        kycReference: testKycRef,
        paymentReceivedAt: new Date(),
        city: 'Bengaluru',
      },
    });
    testJobSeekerId = jobSeeker.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          actorId: { in: [ceoId, callAgentId, fieldAgentId, financeId] },
        },
      });
      if (testJobSeekerId) {
        await prisma.jobSeeker.deleteMany({ where: { id: testJobSeekerId } });
      }
      if (testReferralId) {
        await prisma.referral.deleteMany({ where: { id: testReferralId } });
      }
      await prisma.staff.deleteMany({
        where: { id: { in: [ceoId, callAgentId, fieldAgentId, financeId] } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  describe("Finance PII Masking: Finance sees JS- code and amounts, never phone or KYC reference", () => {
    it('Finance read of GET /job-seekers/:id masks phone and kycReference', async () => {
      const res = await request(app.getHttpServer())
        .get(`/job-seekers/${testJobSeekerId}`)
        .set('Authorization', `Bearer ${financeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(`JS-T8-${timestamp}`);
      expect(res.body.minSalary).toBe(1800000);
      expect(res.body.maxSalary).toBe(2500000);

      // PII MUST be masked
      expect(res.body.phone).toBe('********');
      expect(res.body.kycReference).toBe('********');
      expect(res.body.phone).not.toContain(testPhone);
      expect(res.body.kycReference).not.toContain(testKycRef);
    });

    it('Finance read of GET /job-seekers list masks phone and kycReference for all items', async () => {
      const res = await request(app.getHttpServer())
        .get('/job-seekers')
        .set('Authorization', `Bearer ${financeToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const found = res.body.find((item: { id: string }) => item.id === testJobSeekerId);
      expect(found).toBeDefined();
      expect(found.code).toBe(`JS-T8-${timestamp}`);
      expect(found.phone).toBe('********');
      expect(found.kycReference).toBe('********');
    });

    it('Finance read of GET /referrals/:id masks phone', async () => {
      const res = await request(app.getHttpServer())
        .get(`/referrals/${testReferralId}`)
        .set('Authorization', `Bearer ${financeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.phone).toBe('********');
    });

    it('Non-finance read (Call Agent / CEO) sees unmasked phone and kycReference', async () => {
      const caRes = await request(app.getHttpServer())
        .get(`/job-seekers/${testJobSeekerId}`)
        .set('Authorization', `Bearer ${callAgentToken}`);

      expect(caRes.status).toBe(200);
      expect(caRes.body.phone).toBe(testPhone);
      expect(caRes.body.kycReference).toBe(testKycRef);

      const ceoRes = await request(app.getHttpServer())
        .get(`/job-seekers/${testJobSeekerId}`)
        .set('Authorization', `Bearer ${ceoToken}`);

      expect(ceoRes.status).toBe(200);
      expect(ceoRes.body.phone).toBe(testPhone);
      expect(ceoRes.body.kycReference).toBe(testKycRef);
    });
  });

  describe('Field Agent Access Denial', () => {
    it('Field agent is denied POST /job-seekers (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/job-seekers')
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          name: 'Seeker',
          phone: `91${timestamp.toString().slice(-8)}`,
          otpRequestId: 'any',
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
        });

      expect(res.status).toBe(403);
    });

    it('Field agent is denied GET /job-seekers and GET /job-seekers/:id (403)', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/job-seekers')
        .set('Authorization', `Bearer ${fieldAgentToken}`);
      expect(listRes.status).toBe(403);

      const itemRes = await request(app.getHttpServer())
        .get(`/job-seekers/${testJobSeekerId}`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);
      expect(itemRes.status).toBe(403);
    });

    it('Field agent is denied POST /referrals and GET /referrals (403)', async () => {
      const postRes = await request(app.getHttpServer())
        .post('/referrals')
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          name: 'Partner',
          phone: `92${timestamp.toString().slice(-8)}`,
          otpRequestId: 'any',
        });
      expect(postRes.status).toBe(403);

      const getRes = await request(app.getHttpServer())
        .get('/referrals')
        .set('Authorization', `Bearer ${fieldAgentToken}`);
      expect(getRes.status).toBe(403);
    });
  });
});
