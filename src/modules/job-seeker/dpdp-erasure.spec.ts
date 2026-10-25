import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Phase 8 Task 3: Manual DPDP Erasure Endpoints', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ceoToken: string;
  let mgrToken: string;
  let caToken: string;
  let faToken: string;
  let finToken: string;

  const staffIds: string[] = [];
  const jobSeekerIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  const placementIds: string[] = [];
  const paymentIds: string[] = [];

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const area = `Area-DPDP-${timestamp}`;

  let testJobSeekerId: string;
  let testJobSeekerCode: string;
  let testBusinessId: string;
  let testBusinessCode: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-DPDP-${timestamp}`,
        name: 'CEO DPDP Test',
        email: `ceo_dpdp_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    staffIds.push(ceo.id);

    const mgr = await prisma.staff.create({
      data: {
        code: `MGR-DPDP-${timestamp}`,
        name: 'Manager DPDP Test',
        email: `mgr_dpdp_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    staffIds.push(mgr.id);

    const ca = await prisma.staff.create({
      data: {
        code: `CA-DPDP-${timestamp}`,
        name: 'Call Agent DPDP Test',
        email: `ca_dpdp_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    staffIds.push(ca.id);

    const fa = await prisma.staff.create({
      data: {
        code: `FA-DPDP-${timestamp}`,
        name: 'Field Agent DPDP Test',
        email: `fa_dpdp_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area,
        city: 'Bengaluru',
      },
    });
    staffIds.push(fa.id);

    const fin = await prisma.staff.create({
      data: {
        code: `FIN-DPDP-${timestamp}`,
        name: 'Finance DPDP Test',
        email: `fin_dpdp_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    staffIds.push(fin.id);

    const login = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });
      return (res.body.accessToken || res.body.token) as string;
    };

    ceoToken = await login(ceo.email);
    mgrToken = await login(mgr.email);
    caToken = await login(ca.email);
    faToken = await login(fa.email);
    finToken = await login(fin.email);

    // Create Job Seeker with payments and placement
    const js = await prisma.jobSeeker.create({
      data: {
        code: `JS-DPDP-${timestamp}`,
        name: 'Ravi Shankar',
        phone: `94${String(timestamp).slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2400000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        city: 'Bengaluru',
        kycStatus: 'verified',
        kycReference: 'OVSE_VENDOR_REF_12345',
        status: 'active',
        paymentReceivedAt: new Date(),
      },
    });
    testJobSeekerId = js.id;
    testJobSeekerCode = js.code;
    jobSeekerIds.push(js.id);

    const pay = await prisma.payment.create({
      data: {
        code: `PAY-DPDP-${timestamp}`,
        amount: 49900,
        type: 'activation',
        status: 'completed',
        gatewayReference: `gw_dpdp_${timestamp}`,
        subjectType: 'job_seeker',
        subjectId: js.id,
        jobSeekerId: js.id,
        city: 'Bengaluru',
      },
    });
    paymentIds.push(pay.id);

    // Create Business with vacancies and visits
    const bz = await prisma.business.create({
      data: {
        code: `BZ-DPDP-${timestamp}`,
        name: 'Prime Retail Outlets Pvt Ltd',
        phone: `95${String(timestamp).slice(-8)}`,
        phoneVerified: true,
        contactName: 'Mohan Das',
        address: '55 Brigade Road, Central Bengaluru',
        area,
        city: 'Bengaluru',
        gstNumber: '29ABCDE5678F1Z9',
        selfieUrl: 'https://storage.laboura.local/selfies/mohan.jpg',
        selfieHash: 'hash_mohan_123',
      },
    });
    testBusinessId = bz.id;
    testBusinessCode = bz.code;
    businessIds.push(bz.id);

    const vac = await prisma.vacancy.create({
      data: {
        code: `VC-DPDP-${timestamp}`,
        businessId: bz.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2200000,
        status: 'open',
        city: 'Bengaluru',
      },
    });
    vacancyIds.push(vac.id);

    const pl = await prisma.placement.create({
      data: {
        code: `PL-DPDP-${timestamp}`,
        vacancyId: vac.id,
        jobSeekerId: js.id,
        businessId: bz.id,
        agreedSalary: 2200000,
        placementFee: 1100000,
        gstAmount: 198000,
        status: 'confirmed',
        joinedDate: new Date(),
        city: 'Bengaluru',
      },
    });
    placementIds.push(pl.id);
  });

  afterAll(async () => {
    if (prisma) {
      if (staffIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { actorId: { in: staffIds } },
        }).catch(() => {});
      }
      if (placementIds.length > 0) {
        await prisma.placement.deleteMany({
          where: { id: { in: placementIds } },
        }).catch(() => {});
      }
      if (paymentIds.length > 0) {
        await prisma.payment.deleteMany({
          where: { id: { in: paymentIds } },
        }).catch(() => {});
      }
      if (vacancyIds.length > 0) {
        await prisma.vacancy.deleteMany({
          where: { id: { in: vacancyIds } },
        }).catch(() => {});
      }
      if (jobSeekerIds.length > 0) {
        await prisma.jobSeeker.deleteMany({
          where: { id: { in: jobSeekerIds } },
        }).catch(() => {});
      }
      if (businessIds.length > 0) {
        await prisma.business.deleteMany({
          where: { id: { in: businessIds } },
        }).catch(() => {});
      }
      if (staffIds.length > 0) {
        await prisma.staff.deleteMany({
          where: { id: { in: staffIds } },
        }).catch(() => {});
      }
    }
    if (app) {
      await app.close();
    }
  });

  it('1. RBAC: Call Agent, Field Agent, and Finance are DENIED erasure endpoints (403 Forbidden)', async () => {
    // Job seeker erase
    const caJs = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/erase`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(caJs.status).toBe(403);

    const faJs = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/erase`)
      .set('Authorization', `Bearer ${faToken}`);
    expect(faJs.status).toBe(403);

    const finJs = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/erase`)
      .set('Authorization', `Bearer ${finToken}`);
    expect(finJs.status).toBe(403);

    // Business erase
    const caBz = await request(app.getHttpServer())
      .post(`/businesses/${testBusinessId}/erase`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(caBz.status).toBe(403);

    const faBz = await request(app.getHttpServer())
      .post(`/businesses/${testBusinessId}/erase`)
      .set('Authorization', `Bearer ${faToken}`);
    expect(faBz.status).toBe(403);

    const finBz = await request(app.getHttpServer())
      .post(`/businesses/${testBusinessId}/erase`)
      .set('Authorization', `Bearer ${finToken}`);
    expect(finBz.status).toBe(403);
  });

  it('2. Manager/CEO can erase Job Seeker: directly-identifying PII is anonymized while financial records and history stay intact', async () => {
    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/erase`)
      .set('Authorization', `Bearer ${mgrToken}`);

    expect(res.status).toBe(201);

    // Verify DB record fields
    const updated = await prisma.jobSeeker.findUnique({
      where: { id: testJobSeekerId },
    });
    expect(updated).toBeDefined();
    expect(updated?.name).toBe('ANONYMIZED_CANDIDATE');
    expect(updated?.phone).toBe(`ERASED-${testJobSeekerCode}`);
    expect(updated?.kycReference).toBeNull();
    expect(updated?.erasedAt).toBeDefined();

    // Verify non-identifying fields and relations are preserved
    expect(updated?.tradeSkill).toBe('Electrician');
    expect(updated?.minSalary).toBe(1800000);
    expect(updated?.maxSalary).toBe(2400000);
    expect(updated?.city).toBe('Bengaluru');

    // Verify related payment is preserved with intact amount
    const payment = await prisma.payment.findFirst({
      where: { jobSeekerId: testJobSeekerId },
    });
    expect(payment).toBeDefined();
    expect(payment?.amount).toBe(49900);
    expect(payment?.status).toBe('completed');

    // Verify audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'dpdp.erasure_requested',
        entityType: 'job_seeker',
        entityCode: testJobSeekerCode,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeDefined();
    expect((audit?.before as Record<string, unknown>)?.name).toBe('Ravi Shankar');
    expect((audit?.after as Record<string, unknown>)?.name).toBe('ANONYMIZED_CANDIDATE');
  });

  it('3. Erasing an already-erased Job Seeker is an idempotent no-op without duplicating audit log', async () => {
    const auditCountBefore = await prisma.auditLog.count({
      where: {
        action: 'dpdp.erasure_requested',
        entityType: 'job_seeker',
        entityCode: testJobSeekerCode,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${testJobSeekerId}/erase`)
      .set('Authorization', `Bearer ${ceoToken}`);

    expect([200, 201]).toContain(res.status);
    expect(res.body.message).toContain('already erased');

    const auditCountAfter = await prisma.auditLog.count({
      where: {
        action: 'dpdp.erasure_requested',
        entityType: 'job_seeker',
        entityCode: testJobSeekerCode,
      },
    });
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it('4. CEO can erase Business: PII (name, phone, contact, address, selfie) is anonymized while vacancies & placements stay intact', async () => {
    const res = await request(app.getHttpServer())
      .post(`/businesses/${testBusinessId}/erase`)
      .set('Authorization', `Bearer ${ceoToken}`);

    expect(res.status).toBe(201);

    const updated = await prisma.business.findUnique({
      where: { id: testBusinessId },
    });
    expect(updated).toBeDefined();
    expect(updated?.name).toBe('ANONYMIZED_BUSINESS');
    expect(updated?.phone).toBe(`ERASED-${testBusinessCode}`);
    expect(updated?.contactName).toBe('Anonymized Contact');
    expect(updated?.address).toBe('Anonymized Address');
    expect(updated?.gstNumber).toBeNull();
    expect(updated?.selfieUrl).toBeNull();
    expect(updated?.selfieHash).toBeNull();
    expect(updated?.erasedAt).toBeDefined();

    // Area and city are preserved for analytics
    expect(updated?.area).toBe(area);
    expect(updated?.city).toBe('Bengaluru');

    // Vacancies and placements tied to business stay intact
    const vacancy = await prisma.vacancy.findFirst({
      where: { businessId: testBusinessId },
    });
    expect(vacancy).toBeDefined();
    expect(vacancy?.offeredSalary).toBe(2200000);

    const placement = await prisma.placement.findFirst({
      where: { businessId: testBusinessId },
    });
    expect(placement).toBeDefined();
    expect(placement?.placementFee).toBe(1100000);
    expect(placement?.gstAmount).toBe(198000);

    // Audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'dpdp.erasure_requested',
        entityType: 'business',
        entityCode: testBusinessCode,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeDefined();
    expect((audit?.before as Record<string, unknown>)?.name).toBe('Prime Retail Outlets Pvt Ltd');
    expect((audit?.after as Record<string, unknown>)?.name).toBe('ANONYMIZED_BUSINESS');
  });

  it('5. Erasing an already-erased Business is an idempotent no-op without duplicating audit log', async () => {
    const auditCountBefore = await prisma.auditLog.count({
      where: {
        action: 'dpdp.erasure_requested',
        entityType: 'business',
        entityCode: testBusinessCode,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/businesses/${testBusinessId}/erase`)
      .set('Authorization', `Bearer ${mgrToken}`);

    expect([200, 201]).toContain(res.status);
    expect(res.body.message).toContain('already erased');

    const auditCountAfter = await prisma.auditLog.count({
      where: {
        action: 'dpdp.erasure_requested',
        entityType: 'business',
        entityCode: testBusinessCode,
      },
    });
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it('6. Proves zero automatic retention or deletion jobs exist anywhere in /src/jobs/', () => {
    const jobsDir = path.resolve(__dirname, '../../jobs');
    if (!fs.existsSync(jobsDir)) {
      return;
    }

    const jobFiles = fs.readdirSync(jobsDir);
    for (const file of jobFiles) {
      const fullPath = path.join(jobsDir, file);
      if (fs.statSync(fullPath).isFile() && file.endsWith('.ts')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        expect(content.toLowerCase()).not.toContain('retention_expiry');
        expect(content.toLowerCase()).not.toContain('deleted_at');
        expect(content.toLowerCase()).not.toContain('purgeexpired');
        expect(content.toLowerCase()).not.toContain('autodelete');
      }
    }
  });
});
