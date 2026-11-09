import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { IdService } from '../../common/id/id.service';
import { AnonymisationService } from '../../common/anonymisation/anonymisation.service';
import {
  CANDIDATE_PHOTO_STORAGE,
  CandidatePhotoStorage,
  MemoryCandidatePhotoStorage,
} from '../job-seeker/photo-storage';

describe('Phase 19 Task 2: One way to anonymise', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let idService: IdService;
  let anonymisationService: AnonymisationService;
  let photoStorage: CandidatePhotoStorage;

  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const bizIds: string[] = [];
  const vacancyIds: string[] = [];
  const placementIds: string[] = [];
  const referralIds: string[] = [];
  const paymentIds: string[] = [];
  const payoutAccountIds: string[] = [];
  const claimIds: string[] = [];
  const reviewFlagIds: string[] = [];
  const auditLogIds: string[] = [];

  let ceoToken: string;
  let managerToken: string;
  let callAgentToken: string;

  const suffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    idService = app.get(IdService);
    anonymisationService = app.get(AnonymisationService);
    photoStorage = app.get(CANDIDATE_PHOTO_STORAGE);

    // Setup staff
    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-P19-${suffix}`,
        name: 'CEO User',
        email: `ceo_p19_${suffix}@laboura.local`,
        passwordHash: 'hash',
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    staffIds.push(ceo.id);
    ceoToken = await jwt.signAsync({ sub: ceo.id, role: 'ceo', email: ceo.email, code: ceo.code });

    const mgr = await prisma.staff.create({
      data: {
        code: `MGR-P19-${suffix}`,
        name: 'Manager User',
        email: `mgr_p19_${suffix}@laboura.local`,
        passwordHash: 'hash',
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    staffIds.push(mgr.id);
    managerToken = await jwt.signAsync({ sub: mgr.id, role: 'manager', email: mgr.email, code: mgr.code });

    const ca = await prisma.staff.create({
      data: {
        code: `CA-P19-${suffix}`,
        name: 'Call Agent',
        email: `ca_p19_${suffix}@laboura.local`,
        passwordHash: 'hash',
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    staffIds.push(ca.id);
    callAgentToken = await jwt.signAsync({ sub: ca.id, role: 'call_agent', email: ca.email, code: ca.code });
  });

  afterAll(async () => {
    try {
      if (auditLogIds.length) {
        await prisma.auditLog.deleteMany({ where: { id: { in: auditLogIds } } }).catch(() => {});
      }
      if (claimIds.length) {
        await prisma.replacementClaim.deleteMany({ where: { id: { in: claimIds } } }).catch(() => {});
      }
      if (reviewFlagIds.length) {
        await prisma.reviewFlag.deleteMany({ where: { id: { in: reviewFlagIds } } }).catch(() => {});
      }
      if (paymentIds.length) {
        await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } }).catch(() => {});
      }
      if (payoutAccountIds.length) {
        await prisma.payoutAccount.deleteMany({ where: { id: { in: payoutAccountIds } } }).catch(() => {});
      }
      if (placementIds.length) {
        await prisma.placement.deleteMany({ where: { id: { in: placementIds } } }).catch(() => {});
      }
      if (vacancyIds.length) {
        await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } }).catch(() => {});
      }
      if (bizIds.length) {
        await prisma.business.deleteMany({ where: { id: { in: bizIds } } }).catch(() => {});
      }
      if (seekerIds.length) {
        await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } }).catch(() => {});
      }
      if (referralIds.length) {
        await prisma.referral.deleteMany({ where: { id: { in: referralIds } } }).catch(() => {});
      }
      if (staffIds.length) {
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }).catch(() => {});
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  describe('1. Job Seeker Anonymisation', () => {
    let seekerId: string;
    let seekerCode: string;
    const photoPath = `job-seekers/test-photo-${suffix}.png`;
    const cvPath = `job-seekers/test-cv-${suffix}.pdf`;

    beforeAll(async () => {
      seekerCode = await idService.generateCode('job_seeker');
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: seekerCode,
          name: 'Anil Kumar',
          phone: `99${suffix}01`,
          phoneVerified: true,
          whatsappPhone: `99${suffix}02`,
          dateOfBirth: new Date('1992-05-10T00:00:00.000Z'),
          gender: 'male',
          photoStoragePath: photoPath,
          cvStoragePath: cvPath,
          latitude: 12.9716,
          longitude: 77.5946,
          lastEmployer: 'Previous Services Ltd',
          lastRole: 'Driver',
          lastSalaryPaise: 2000000,
          minSalary: 1800000,
          maxSalary: 2500000,
          locality: 'Indiranagar',
          pincode: '560038',
          status: 'active',
          city: 'Bengaluru',
        },
      });
      seekerId = seeker.id;
      seekerIds.push(seekerId);

      // Create photo and cv files in storage
      await photoStorage.put(photoPath, Buffer.from('photo data'), 'image/png');
      await photoStorage.put(cvPath, Buffer.from('cv data'), 'application/pdf');

      // Create a completed payment
      const payCode = await idService.generateCode('payment');
      const pay = await prisma.payment.create({
        data: {
          code: payCode,
          type: 'registration_fee',
          amount: 49900,
          status: 'succeeded',
          jobSeekerId: seekerId,
          city: 'Bengaluru',
        },
      });
      paymentIds.push(pay.id);

      // Create a payout account
      const acc = await prisma.payoutAccount.create({
        data: {
          code: `ACC-${suffix}-1`,
          ownerType: 'job_seeker',
          ownerId: seekerId,
          ownerNameAtEntry: 'Anil Kumar',
          method: 'upi',
          maskedValue: 'anil@okhdfc',
          valueHash: 'hash123',
          upiIdEncrypted: 'enc_upi_123',
          verifiedName: 'Anil Kumar',
          status: 'verified',
          activeFrom: new Date(),
        },
      });
      payoutAccountIds.push(acc.id);
    });

    it('removes every personal field, deletes storage files, sets anonymisedAt, and wipes payout account secrets', async () => {
      const result = await anonymisationService.anonymise('job_seeker', seekerId, 'Test Anonymise Job Seeker');
      expect(result.message).toContain('anonymised successfully');
      expect(result.anonymisedAt).toBeDefined();

      const seeker = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seekerId } });
      expect(seeker.name).toBe('Anonymised');
      expect(seeker.phone).not.toBe(`99${suffix}01`);
      expect(seeker.whatsappPhone).toBeNull();
      expect(seeker.dateOfBirth).toBeNull();
      expect(seeker.gender).toBeNull();
      expect(seeker.photoStoragePath).toBeNull();
      expect(seeker.cvStoragePath).toBeNull();
      expect(seeker.latitude).toBeNull();
      expect(seeker.longitude).toBeNull();
      expect(seeker.lastEmployer).toBeNull();
      expect(seeker.lastRole).toBeNull();
      expect(seeker.lastSalaryPaise).toBeNull();
      expect(seeker.anonymisedAt).toBeDefined();

      // Kept: business figures intact
      expect(seeker.code).toBe(seekerCode);
      expect(seeker.locality).toBe('Indiranagar');
      expect(seeker.pincode).toBe('560038');
      expect(seeker.minSalary).toBe(1800000);
      expect(seeker.maxSalary).toBe(2500000);
      expect(seeker.status).toBe('active');

      // Verify files deleted from storage
      expect((photoStorage as MemoryCandidatePhotoStorage).has(photoPath)).toBe(false);
      expect((photoStorage as MemoryCandidatePhotoStorage).has(cvPath)).toBe(false);

      // Verify payout account wiped
      const acc = await prisma.payoutAccount.findUniqueOrThrow({ where: { id: payoutAccountIds[0] } });
      expect(acc.upiIdEncrypted).toBeNull();
      expect(acc.verifiedName).toBeNull();
      expect(acc.ownerNameAtEntry).toBe('Anonymised');
      expect(acc.maskedValue).toBe('anil@okhdfc');
      expect(acc.status).toBe('verified');

      // Payments still add up in reports
      const payments = await prisma.payment.findMany({ where: { jobSeekerId: seekerId } });
      expect(payments.length).toBe(1);
      expect(payments[0].amount).toBe(49900);

      // Audit log has no personal values
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'job_seeker', entityCode: seekerCode, action: 'dpdp.erasure_requested' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeDefined();
      if (audit) auditLogIds.push(audit.id);
      const auditStr = JSON.stringify(audit);
      expect(auditStr).not.toContain('Anil Kumar');
      expect(auditStr).not.toContain(`99${suffix}01`);
    });

    it('running anonymise twice is an idempotent no-op', async () => {
      const countBefore = await prisma.auditLog.count({
        where: { entityCode: seekerCode, action: 'dpdp.erasure_requested' },
      });

      const result = await anonymisationService.anonymise('job_seeker', seekerId, 'Second run');
      expect(result.message).toContain('already anonymised');

      const countAfter = await prisma.auditLog.count({
        where: { entityCode: seekerCode, action: 'dpdp.erasure_requested' },
      });
      expect(countAfter).toBe(countBefore);
    });
  });

  describe('2. Refusal Rules: Open Claim, Flag, or Unpaid Money', () => {
    it('refuses anonymisation while subject has unpaid pending/approved money', async () => {
      const code = await idService.generateCode('job_seeker');
      const seeker = await prisma.jobSeeker.create({
        data: {
          code,
          name: 'Pending Money Seeker',
          phone: `97${suffix}11`,
          status: 'active',
          city: 'Bengaluru',
        },
      });
      seekerIds.push(seeker.id);

      const pay = await prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          type: 'refund',
          amount: 49900,
          status: 'approved',
          jobSeekerId: seeker.id,
          city: 'Bengaluru',
        },
      });
      paymentIds.push(pay.id);

      await expect(
        anonymisationService.anonymise('job_seeker', seeker.id, 'Attempt while refund approved'),
      ).rejects.toThrow(/unpaid money/);
    });

    it('refuses anonymisation while subject has an open replacement claim', async () => {
      const bzCode = await idService.generateCode('business');
      const bz = await prisma.business.create({
        data: {
          code: bzCode,
          name: 'Claim Test Biz',
          phone: `97${suffix}22`,
          city: 'Bengaluru',
        },
      });
      bizIds.push(bz.id);

      const jsCode = await idService.generateCode('job_seeker');
      const js = await prisma.jobSeeker.create({
        data: {
          code: jsCode,
          name: 'Claim Test Seeker',
          phone: `97${suffix}33`,
          city: 'Bengaluru',
        },
      });
      seekerIds.push(js.id);

      const vcCode = await idService.generateCode('vacancy');
      const vc = await prisma.vacancy.create({
        data: {
          code: vcCode,
          businessId: bz.id,
          tradeSkill: 'Electrician',
          city: 'Bengaluru',
        },
      });
      vacancyIds.push(vc.id);

      const plCode = await idService.generateCode('placement');
      const pl = await prisma.placement.create({
        data: {
          code: plCode,
          businessId: bz.id,
          jobSeekerId: js.id,
          vacancyId: vc.id,
          placementFee: 1000000,
          gstAmount: 180000,
          status: 'dropped_out',
          city: 'Bengaluru',
        },
      });
      placementIds.push(pl.id);

      // Business is refused
      await expect(
        anonymisationService.anonymise('business', bz.id, 'Attempt while claim open'),
      ).rejects.toThrow(/replacement claim/);

      // Job seeker is also refused
      await expect(
        anonymisationService.anonymise('job_seeker', js.id, 'Attempt while claim open'),
      ).rejects.toThrow(/replacement claim/);
    });

    it('refuses anonymisation while subject has an open bypass_suspected flag', async () => {
      const bzCode = await idService.generateCode('business');
      const bz = await prisma.business.create({
        data: {
          code: bzCode,
          name: 'Flag Test Biz',
          phone: `97${suffix}44`,
          city: 'Bengaluru',
        },
      });
      bizIds.push(bz.id);

      const flag = await prisma.reviewFlag.create({
        data: {
          code: `FLG-${suffix}-1`,
          kind: 'bypass_suspected',
          subjectType: 'business',
          subjectId: bz.id,
          status: 'open',
        },
      });
      reviewFlagIds.push(flag.id);

      await expect(
        anonymisationService.anonymise('business', bz.id, 'Attempt while bypass suspected'),
      ).rejects.toThrow(/bypass_suspected flag/);
    });
  });

  describe('3. Business & Referral Anonymisation', () => {
    it('anonymises business: clears PII and contacts, keeps trading name and business figures', async () => {
      const bzCode = await idService.generateCode('business');
      const bz = await prisma.business.create({
        data: {
          code: bzCode,
          name: 'Corner Bakery',
          phone: `97${suffix}55`,
          ownerName: 'Sunita Sharma',
          additionalContactName: 'Manager Rahul',
          additionalContactPhone: `97${suffix}56`,
          billingName: 'Sunita Enterprises',
          billingAddress: '42 Baker Street',
          businessType: 'food_beverage',
          locality: 'Indiranagar',
          city: 'Bengaluru',
        },
      });
      bizIds.push(bz.id);

      const res = await anonymisationService.anonymise('business', bz.id, 'Erase Corner Bakery');
      expect(res.message).toContain('anonymised successfully');

      const updated = await prisma.business.findUniqueOrThrow({ where: { id: bz.id } });
      // Trading name and locality kept!
      expect(updated.name).toBe('Corner Bakery');
      expect(updated.businessType).toBe('food_beverage');
      expect(updated.locality).toBe('Indiranagar');

      // Personal details cleared
      expect(updated.phone).not.toBe(`97${suffix}55`);
      expect(updated.ownerName).toBeNull();
      expect(updated.additionalContactName).toBeNull();
      expect(updated.additionalContactPhone).toBeNull();
      expect(updated.billingName).toBeNull();
      expect(updated.billingAddress).toBeNull();
      expect(updated.anonymisedAt).toBeDefined();
    });

    it('anonymises referral partner: sets placeholder name and phone, keeps code and city', async () => {
      const rfCode = await idService.generateCode('referral');
      const rf = await prisma.referral.create({
        data: {
          code: rfCode,
          name: 'Kavitha Partner',
          phone: `97${suffix}66`,
          type: 'individual',
          city: 'Bengaluru',
        },
      });
      referralIds.push(rf.id);

      const res = await anonymisationService.anonymise('referral', rf.id, 'Erase Partner');
      expect(res.message).toContain('anonymised successfully');

      const updated = await prisma.referral.findUniqueOrThrow({ where: { id: rf.id } });
      expect(updated.name).toBe('Anonymised');
      expect(updated.phone).not.toBe(`97${suffix}66`);
      expect(updated.code).toBe(rfCode);
      expect(updated.type).toBe('individual');
      expect(updated.city).toBe('Bengaluru');
      expect(updated.anonymisedAt).toBeDefined();
    });
  });

  describe('4. Erase HTTP Endpoints Call Shared AnonymisationService', () => {
    it('POST /job-seekers/:id/erase calls AnonymisationService and requires CEO or Manager', async () => {
      const code = await idService.generateCode('job_seeker');
      const js = await prisma.jobSeeker.create({
        data: {
          code,
          name: 'Erase Candidate Test',
          phone: `97${suffix}77`,
          status: 'lead',
          city: 'Bengaluru',
        },
      });
      seekerIds.push(js.id);

      // Call agent forbidden
      const forbiddenRes = await request(app.getHttpServer())
        .post(`/job-seekers/${js.id}/erase`)
        .set('Authorization', `Bearer ${callAgentToken}`);
      expect(forbiddenRes.status).toBe(403);

      // Manager allowed
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${js.id}/erase`)
        .set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(201);

      const updated = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: js.id } });
      expect(updated.name).toBe('Anonymised');
      expect(updated.anonymisedAt).toBeDefined();
    });

    it('POST /businesses/:id/erase calls AnonymisationService and requires CEO or Manager', async () => {
      const code = await idService.generateCode('business');
      const bz = await prisma.business.create({
        data: {
          code,
          name: 'Erase Biz Test',
          phone: `97${suffix}88`,
          city: 'Bengaluru',
        },
      });
      bizIds.push(bz.id);

      // CEO allowed
      const res = await request(app.getHttpServer())
        .post(`/businesses/${bz.id}/erase`)
        .set('Authorization', `Bearer ${ceoToken}`);
      expect(res.status).toBe(201);

      const updated = await prisma.business.findUniqueOrThrow({ where: { id: bz.id } });
      expect(updated.anonymisedAt).toBeDefined();
    });
  });
});
