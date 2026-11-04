import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentService } from '../consent/consent.service';

describe('Phase 12 Task 5 — IdentityVerification', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let consentService: ConsentService;

  let callAgentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;

  const createdStaffIds: string[] = [];
  const createdSeekerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    consentService = app.get(ConsentService);

    const passwordHash = await bcrypt.hash('StaffPassword123!', 4);

    const suffixCa = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    const ca = await prisma.staff.create({
      data: {
        code: `CA-IDV-${suffixCa}`,
        name: 'Task 5 Call Agent',
        email: `ca_idv_${suffixCa}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        status: 'active',
      },
    });
    createdStaffIds.push(ca.id);
    callAgentToken = jwt.sign({ sub: ca.id, role: ca.role, code: ca.code, email: ca.email });

    const suffixFa = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    const fa = await prisma.staff.create({
      data: {
        code: `FA-IDV-${suffixFa}`,
        name: 'Task 5 Field Agent',
        email: `fa_idv_${suffixFa}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        status: 'active',
      },
    });
    createdStaffIds.push(fa.id);
    fieldAgentToken = jwt.sign({ sub: fa.id, role: fa.role, code: fa.code, email: fa.email });

    const suffixFin = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    const fin = await prisma.staff.create({
      data: {
        code: `FIN-IDV-${suffixFin}`,
        name: 'Task 5 Finance',
        email: `fin_idv_${suffixFin}@laboura.local`,
        passwordHash,
        role: 'finance',
        status: 'active',
      },
    });
    createdStaffIds.push(fin.id);
    financeToken = jwt.sign({ sub: fin.id, role: fin.role, code: fin.code, email: fin.email });
  });

  afterAll(async () => {
    if (createdSeekerIds.length > 0) {
      await prisma.identityVerification.deleteMany({
        where: { jobSeekerId: { in: createdSeekerIds } },
      });
      await prisma.consent.deleteMany({
        where: { subjectId: { in: createdSeekerIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { entityCode: { in: createdSeekerIds } },
      });
      await prisma.jobSeeker.deleteMany({
        where: { id: { in: createdSeekerIds } },
      });
    }
    if (createdStaffIds.length > 0) {
      await prisma.staff.deleteMany({
        where: { id: { in: createdStaffIds } },
      });
    }
    await app.close();
  });

  async function createCandidate(options?: { kycStatus?: string; kycReference?: string }): Promise<string> {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const phoneSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-IDV-${suffix}`,
        name: `Candidate ${suffix}`,
        phone: `+9193${phoneSuffix}`,
        tradeSkill: 'Plumber',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'consented',
        kycStatus: options?.kycStatus ?? 'pending',
        kycReference: options?.kycReference ?? null,
      },
    });
    createdSeekerIds.push(seeker.id);
    return seeker.id;
  }

  async function grantAadhaarConsent(jobSeekerId: string) {
    await consentService.grant({
      subjectType: 'job_seeker',
      subjectId: jobSeekerId,
      purpose: 'aadhaar_verification',
      noticeVersion: '2026-11-01',
      language: 'en',
      method: 'sms_link',
    });
  }

  it('1. Refuses verification request when Consent.aadhaar_verification is not granted', async () => {
    const seekerId = await createCandidate();

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'digilocker',
        last4: '4321',
        nameMatches: true,
        isAdult: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('aadhaar_verification');
  });

  it('2. Succeeds when Consent.aadhaar_verification is granted, persists last4, nameMatches, isAdult', async () => {
    const seekerId = await createCandidate();
    await grantAadhaarConsent(seekerId);

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'digilocker',
        vendor: 'digilocker',
        vendorReference: 'DL-REF-998811',
        last4: '7788',
        nameMatches: true,
        isAdult: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.jobSeekerId).toBe(seekerId);
    expect(res.body.method).toBe('digilocker');
    expect(res.body.vendor).toBe('digilocker');
    expect(res.body.vendorReference).toBe('DL-REF-998811');
    expect(res.body.status).toBe('verified');
    expect(res.body.last4).toBe('7788');
    expect(res.body.nameMatches).toBe(true);
    expect(res.body.isAdult).toBe(true);
    expect(res.body.verifiedAt).toBeDefined();

    // Verify in database
    const dbRecord = await prisma.identityVerification.findUnique({
      where: { id: res.body.id },
    });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord?.last4).toBe('7788');
    expect(dbRecord?.nameMatches).toBe(true);
    expect(dbRecord?.isAdult).toBe(true);
    expect(dbRecord?.status).toBe('verified');
  });

  it('3. Rejects raw Aadhaar fields and numbers through assertNoRawAadhaar guard', async () => {
    const seekerId = await createCandidate();
    await grantAadhaarConsent(seekerId);

    // Test with explicit "aadhaar" key
    const resAadhaarKey = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'digilocker',
        aadhaarNumber: '999988887777',
        last4: '7777',
      });
    expect(resAadhaarKey.status).toBe(400);
    expect(resAadhaarKey.body.message).toContain('Raw Aadhaar');

    // Test with 12 consecutive digits in any key
    const resConsecutiveDigits = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'digilocker',
        documentId: '123456789012',
      });
    expect(resConsecutiveDigits.status).toBe(400);
    expect(resConsecutiveDigits.body.message).toContain('Raw Aadhaar');

    // Test with 4-4-4 formatted digits
    const resFormattedDigits = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'digilocker',
        nationalId: '1234 5678 9012',
      });
    expect(resFormattedDigits.status).toBe(400);
    expect(resFormattedDigits.body.message).toContain('Raw Aadhaar');
  });

  it('4. Rejects last4 if not exactly 4 digits', async () => {
    const seekerId = await createCandidate();
    await grantAadhaarConsent(seekerId);

    const resTooShort = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'digilocker',
        last4: '123',
      });
    expect(resTooShort.status).toBe(400);
    expect(resTooShort.body.message).toContain('last4 must be exactly 4 digits');

    const resTooLong = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'digilocker',
        last4: '12345',
      });
    expect(resTooLong.status).toBe(400);
    expect(resTooLong.body.message).toContain('last4 must be exactly 4 digits');
  });

  it('5. Does NOT write to deprecated JobSeeker.kycStatus or kycReference columns', async () => {
    const initialKycRef = 'ORIGINAL-REF-1122';
    const seekerId = await createCandidate({
      kycStatus: 'pending',
      kycReference: initialKycRef,
    });
    await grantAadhaarConsent(seekerId);

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'digilocker',
        vendor: 'digilocker',
        vendorReference: 'NEW-VENDOR-REF-99',
        last4: '5566',
        nameMatches: true,
        isAdult: true,
      });

    expect(res.status).toBe(201);

    // JobSeeker record should NOT have been updated
    const seekerInDb = await prisma.jobSeeker.findUnique({
      where: { id: seekerId },
    });
    expect(seekerInDb?.kycStatus).toBe('pending');
    expect(seekerInDb?.kycReference).toBe(initialKycRef);
  });

  it('6. Supports all allowed methods (digilocker, aadhaar_qr, pan, driving_licence, voter_id) and rejects invalid', async () => {
    const seekerId = await createCandidate();
    await grantAadhaarConsent(seekerId);

    const validMethods = ['digilocker', 'aadhaar_qr', 'pan', 'driving_licence', 'voter_id'];
    for (const method of validMethods) {
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${seekerId}/identity-verification`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          method,
          last4: '1111',
          nameMatches: true,
          isAdult: true,
        });
      expect(res.status).toBe(201);
      expect(res.body.method).toBe(method);
    }

    const resInvalid = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'passport',
        last4: '1111',
      });
    expect(resInvalid.status).toBe(400);
    expect(resInvalid.body.message).toContain('Invalid identity verification method');
  });

  it('7. Handles failed verification and records failureReason', async () => {
    const seekerId = await createCandidate();
    await grantAadhaarConsent(seekerId);

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'voter_id',
        status: 'failed',
        failureReason: 'Name mismatch on voter ID card',
        nameMatches: false,
        isAdult: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('failed');
    expect(res.body.failureReason).toBe('Name mismatch on voter ID card');
    expect(res.body.nameMatches).toBe(false);
    expect(res.body.verifiedAt).toBeNull();
  });

  it('8. RBAC: Field Agent can request verification; Finance is denied', async () => {
    const seekerId = await createCandidate();
    await grantAadhaarConsent(seekerId);

    // Field Agent allowed
    const faRes = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({
        method: 'aadhaar_qr',
        last4: '8899',
        nameMatches: true,
        isAdult: true,
      });
    expect(faRes.status).toBe(201);

    // Finance denied
    const finRes = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        method: 'aadhaar_qr',
        last4: '8899',
        nameMatches: true,
        isAdult: true,
      });
    expect(finRes.status).toBe(403);
  });

  it('9. GET /job-seekers/:id/identity-verifications lists all verifications for seeker', async () => {
    const seekerId = await createCandidate();
    await grantAadhaarConsent(seekerId);

    await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/identity-verification`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        method: 'digilocker',
        last4: '2233',
        nameMatches: true,
        isAdult: true,
      });

    const listRes = await request(app.getHttpServer())
      .get(`/job-seekers/${seekerId}/identity-verifications`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body[0].last4).toBe('2233');
  });
});
