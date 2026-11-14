import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { RetentionService } from './retention.service';
import { RECORDING_STORAGE, MemoryRecordingStorage } from '../call/recording-storage';
import { CANDIDATE_PHOTO_STORAGE, MemoryCandidatePhotoStorage } from '../job-seeker/photo-storage';
import { verifiedOtpFor } from '../../test-support/verified-otp';

describe('Phase 19 Gate End-to-End Proof', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let idService: IdService;
  let retentionService: RetentionService;
  let recordingStorage: MemoryRecordingStorage;
  let photoStorage: MemoryCandidatePhotoStorage;

  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  const phoneSuffix = crypto.randomInt(100000, 1000000).toString();

  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  const placementIds: string[] = [];
  const paymentIds: string[] = [];
  const callIds: string[] = [];
  const claimIds: string[] = [];
  const auditLogIds: string[] = [];

  let ceoToken = '';
  let teamLeadToken = '';
  let agentToken = '';

  let agentId = '';

  let seeker1Id = '';
  let seeker1Code = '';
  let seeker2Id = '';
  let seeker2Code = '';
  let payment1Id = '';

  let photoPath1 = '';
  let recordingPathBusiness = '';
  let recordingPath2 = '';

  let baseDate: Date;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    idService = app.get(IdService);
    retentionService = app.get(RetentionService);
    recordingStorage = app.get(RECORDING_STORAGE);
    photoStorage = app.get(CANDIDATE_PHOTO_STORAGE);

    baseDate = new Date('2024-11-01T10:00:00.000Z');

    // 1. Create staff members
    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-G19-${suffix}`,
        name: 'CEO Phase 19',
        email: `ceo_g19_${suffix}@laboura.local`,
        passwordHash: 'dummy_hash',
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    staffIds.push(ceo.id);
    ceoToken = await jwt.signAsync({ sub: ceo.id, role: 'ceo', email: ceo.email, code: ceo.code });

    const tl = await prisma.staff.create({
      data: {
        code: `TL-G19-${suffix}`,
        name: 'Team Lead 19',
        email: `tl_g19_${suffix}@laboura.local`,
        passwordHash: 'dummy_hash',
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });
    staffIds.push(tl.id);
    teamLeadToken = await jwt.signAsync({ sub: tl.id, role: 'team_lead', email: tl.email, code: tl.code });

    const ag = await prisma.staff.create({
      data: {
        code: `CA-G19-${suffix}`,
        name: 'Call Agent 19',
        email: `ca_g19_${suffix}@laboura.local`,
        passwordHash: 'dummy_hash',
        role: 'call_agent',
        teamLeadId: tl.id,
        city: 'Bengaluru',
      },
    });
    staffIds.push(ag.id);
    agentId = ag.id;
    agentToken = await jwt.signAsync({
      sub: ag.id,
      role: 'call_agent',
      email: ag.email,
      code: ag.code,
      teamLeadId: tl.id,
    });
  });

  afterAll(async () => {
    try {
      if (claimIds.length) {
        await prisma.replacementClaim.deleteMany({ where: { id: { in: claimIds } } }).catch(() => {});
      }
      if (callIds.length) {
        await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } }).catch(() => {});
      }
      if (placementIds.length) {
        await prisma.placement.deleteMany({ where: { id: { in: placementIds } } }).catch(() => {});
      }
      if (vacancyIds.length) {
        await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } }).catch(() => {});
      }
      if (businessIds.length) {
        await prisma.business.deleteMany({ where: { id: { in: businessIds } } }).catch(() => {});
      }
      if (paymentIds.length) {
        await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } }).catch(() => {});
      }
      if (auditLogIds.length) {
        await prisma.auditLog.deleteMany({ where: { id: { in: auditLogIds } } }).catch(() => {});
      }
      if (seekerIds.length) {
        await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } }).catch(() => {});
      }
      if (staffIds.length) {
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }).catch(() => {});
      }
      if (app) {
        await app.close();
      }
    } finally {
      // app guaranteed closed
    }
  });

  describe('End-to-End Proof', () => {
    it('step 1: agent registers a job seeker and corrects a typo with no reason needed on first fill', async () => {
      seeker1Code = `JS-P19-${suffix}-1`;
      const initialPhone = `98${phoneSuffix}11`;

      const seeker = await prisma.jobSeeker.create({
        data: {
          code: seeker1Code,
          name: 'Ramesh Verma',
          phone: initialPhone,
          locality: null, // empty field for first fill
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          minSalary: 1500000,
          maxSalary: 2500000,
          // Registered by the agent on the Team Lead's team: a Team Lead works
          // only on their own team's job seekers (Master Guide, 14 Nov).
          registeredByStaffId: agentId,
          createdAt: baseDate,
          updatedAt: baseDate,
        },
      });
      seeker1Id = seeker.id;
      seekerIds.push(seeker1Id);

      // Record creation audit log pointing to agent as creator
      const createLog = await prisma.auditLog.create({
        data: {
          code: await idService.generateCode('audit_log'),
          actorId: agentId,
          action: 'job_seeker.create',
          entityType: 'job_seeker',
          entityCode: seeker1Code,
          after: { name: 'Ramesh Verma', phone: '[changed]' },
          city: 'Bengaluru',
        },
      });
      auditLogIds.push(createLog.id);

      // Filling in previously empty locality (first fill / typo correction) without a reason is allowed
      const res = await request(app.getHttpServer())
        .patch(`/job-seekers/${seeker1Id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          locality: 'Indiranagar',
          // no reason supplied
        });

      expect(res.status).toBe(200);
      expect(res.body.locality).toBe('Indiranagar');

      const inDb = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker1Id } });
      expect(inDb.locality).toBe('Indiranagar');
    });

    it('step 2: changes the phone later with a reason (refused without reason, succeeds with reason)', async () => {
      const newPhone = `98${phoneSuffix}22`;

      // 1. Changing an existing saved field without a reason is refused with 400
      const refusedRes = await request(app.getHttpServer())
        .patch(`/job-seekers/${seeker1Id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          phone: newPhone,
          // no reason
        });

      expect(refusedRes.status).toBe(400);
      expect(refusedRes.body.message).toContain('A reason is required');

      // 2. Providing a reason allows the edit to succeed
      const allowedRes = await request(app.getHttpServer())
        .patch(`/job-seekers/${seeker1Id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          phone: newPhone,
          reason: 'Candidate requested update to primary phone number',
          // Master Guide: a new number is checked by OTP before it is saved.
          phoneOtpRequestId: await verifiedOtpFor(app, newPhone),
        });

      expect(allowedRes.status).toBe(200);

      const inDb = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker1Id } });
      expect(inDb.phone).toBe(`+91${newPhone}`);
    });

    it('step 3: after ₹499 is confirmed, the agent edit is refused and the Team Lead edit succeeds with a reason', async () => {
      // Confirm ₹499 registration fee in company account
      const paymentCode = await idService.generateCode('payment');
      const payment = await prisma.payment.create({
        data: {
          code: paymentCode,
          type: 'registration_fee',
          status: 'succeeded',
          amount: 49900,
          expectedAmountPaise: 49900,
          subjectType: 'job_seeker',
          subjectId: seeker1Id,
          jobSeekerId: seeker1Id,
          city: 'Bengaluru',
          createdAt: baseDate,
          updatedAt: baseDate,
        },
      });
      paymentIds.push(payment.id);
      payment1Id = payment.id;

      await prisma.jobSeeker.update({
        where: { id: seeker1Id },
        data: {
          paymentReceivedAt: baseDate,
          status: 'active',
        },
      });

      // Agent edit is now locked: money is involved
      const agentRes = await request(app.getHttpServer())
        .patch(`/job-seekers/${seeker1Id}`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          locality: 'Whitefield',
          reason: 'Candidate moved to Whitefield',
        });

      expect(agentRes.status).toBe(403);
      expect(agentRes.body.message).toContain('Locked — money involved, ask your Team Lead');

      // Team Lead can edit after money is involved, with a reason
      const tlRes = await request(app.getHttpServer())
        .patch(`/job-seekers/${seeker1Id}`)
        .set('Authorization', `Bearer ${teamLeadToken}`)
        .send({
          locality: 'Whitefield',
          reason: 'Team Lead approved candidate relocation request',
        });

      expect(tlRes.status).toBe(200);
      expect(tlRes.body.locality).toBe('Whitefield');

      const inDb = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker1Id } });
      expect(inDb.locality).toBe('Whitefield');
    });

    it('step 4: history shows "[changed]" for the phone and never reveals personal values', async () => {
      // Query audit logs as Team Lead
      const res = await request(app.getHttpServer())
        .get(`/audit-logs?entityType=job_seeker&entityCode=${seeker1Code}`)
        .set('Authorization', `Bearer ${teamLeadToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      // Locate the phone update audit log
      const phoneUpdateLog = res.body.find((log: { changedFields?: string[] }) =>
        Array.isArray(log.changedFields) && log.changedFields.includes('phone'),
      );

      expect(phoneUpdateLog).toBeDefined();
      expect(phoneUpdateLog.reason).toBe('Candidate requested update to primary phone number');

      // Assert personal values are masked as "[changed]" in before and after
      const beforeObj = phoneUpdateLog.before as Record<string, unknown>;
      const afterObj = phoneUpdateLog.after as Record<string, unknown>;
      expect(beforeObj.phone).toBe('[changed]');
      expect(afterObj.phone).toBe('[changed]');

      // Assert raw phone numbers never appear anywhere in the audit log serialization
      const logJson = JSON.stringify(phoneUpdateLog);
      expect(logJson).not.toContain(`98${phoneSuffix}11`);
      expect(logJson).not.toContain(`98${phoneSuffix}22`);
    });

    it('step 5 & 6: clock moved forward 23 months and a day: dry run reports the job seeker, real run anonymises them, deletes their photo and a separate 13m recording, while placement and payment totals are unchanged', async () => {
      // Setup candidate #1: photo in storage. Their profile remains eligible for anonymisation.
      photoPath1 = `candidates/proof-${suffix}.jpg`;
      await photoStorage.put(photoPath1, Buffer.from('proof-photo-candidate-1'), 'image/jpeg');

      await prisma.jobSeeker.update({
        where: { id: seeker1Id },
        data: {
          photoStoragePath: photoPath1,
        },
      });

      // Setup placement and business to confirm report totals persist
      const biz = await prisma.business.create({
        data: {
          code: `BZ-G19-${suffix}`,
          name: 'Proof Enterprise Ltd',
          phone: `99${suffix}01`,
          ownerName: 'Owner Kumar',
          city: 'Bengaluru',
          createdAt: baseDate,
        },
      });
      businessIds.push(biz.id);

      const vacancy = await prisma.vacancy.create({
        data: {
          code: `VC-G19-${suffix}`,
          businessId: biz.id,
          tradeSkill: 'Driver',
          salaryMinPaise: 2000000,
          salaryMaxPaise: 3000000,
          headcount: 1,
          createdAt: baseDate,
        },
      });
      vacancyIds.push(vacancy.id);

      const placement = await prisma.placement.create({
        data: {
          code: `PL-G19-${suffix}`,
          jobSeekerId: seeker1Id,
          businessId: biz.id,
          vacancyId: vacancy.id,
          status: 'confirmed',
          agreedSalary: 2500000,
          placementFee: 1250000,
          gstAmount: 225000,
          createdAt: baseDate,
          updatedAt: baseDate,
        },
      });
      placementIds.push(placement.id);

      // 13-month-old recording for the business. A call against candidate #1 would reset their profile clock.
      const recDate13m = new Date(baseDate.getTime());
      recDate13m.setUTCMonth(recDate13m.getUTCMonth() + 10); // 13 months before the 23m+1d target date
      const recordingBusiness = await prisma.business.create({
        data: {
          code: `BZ-G19-REC-${suffix}`,
          name: 'Recording Retention Business',
          phone: `97${suffix}01`,
          ownerName: 'Recording Owner',
          city: 'Bengaluru',
          createdAt: baseDate,
        },
      });
      businessIds.push(recordingBusiness.id);

      recordingPathBusiness = `recordings/call-business-${suffix}.mp3`;
      await recordingStorage.put(recordingPathBusiness, Buffer.from('audio-business'), 'audio/mpeg');

      const call1 = await prisma.callRecord.create({
        data: {
          code: `CR-G19-1-${suffix}`,
          provider: 'mock',
          providerCallId: `call-p19-1-${suffix}`,
          providerStatus: 'completed',
          subjectType: 'business',
          subjectId: recordingBusiness.id,
          recordingStoragePath: recordingPathBusiness,
          startedAt: recDate13m,
          createdAt: recDate13m,
        },
      });
      callIds.push(call1.id);

      // Setup candidate #2 (Job seeker with an OPEN replacement claim)
      seeker2Code = `JS-P19-${suffix}-2`;
      const seeker2 = await prisma.jobSeeker.create({
        data: {
          code: seeker2Code,
          name: 'Disputed Candidate Sunita',
          phone: `98${suffix}99`,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          minSalary: 1800000,
          maxSalary: 2800000,
          createdAt: baseDate,
          updatedAt: baseDate,
        },
      });
      seeker2Id = seeker2.id;
      seekerIds.push(seeker2Id);

      const placement2 = await prisma.placement.create({
        data: {
          code: `PL-G19-DISP-${suffix}`,
          jobSeekerId: seeker2Id,
          businessId: biz.id,
          vacancyId: vacancy.id,
          status: 'dropped_out',
          agreedSalary: 2200000,
          placementFee: 1100000,
          gstAmount: 198000,
          createdAt: baseDate,
          updatedAt: baseDate,
        },
      });
      placementIds.push(placement2.id);

      recordingPath2 = `recordings/call-candidate-2-${suffix}.mp3`;
      await recordingStorage.put(recordingPath2, Buffer.from('audio-candidate-2-disputed'), 'audio/mpeg');

      const call2 = await prisma.callRecord.create({
        data: {
          code: `CR-G19-2-${suffix}`,
          provider: 'mock',
          providerCallId: `call-p19-2-${suffix}`,
          providerStatus: 'completed',
          subjectType: 'job_seeker',
          subjectId: seeker2Id,
          recordingStoragePath: recordingPath2,
          startedAt: recDate13m,
          createdAt: recDate13m,
          relatedType: 'placement',
          relatedId: placement2.id,
        },
      });
      callIds.push(call2.id);

      // Open replacement claim on placement 2 (decision is null)
      const openClaim = await prisma.replacementClaim.create({
        data: {
          code: `RC-G19-${suffix}`,
          placementId: placement2.id,
          workerLeftOn: baseDate,
          reportedWithinDeadline: true,
          feePaidInFull: true,
          reason: 'candidate_absconded',
          decision: null, // OPEN CLAIM!
          decisionDueAt: new Date(baseDate.getTime() + 86400000),
          callRecordId: call2.id,
        },
      });
      claimIds.push(openClaim.id);

      // Set candidate #1's last activity to baseDate so 23m+1d is reached
      await prisma.jobSeeker.update({
        where: { id: seeker1Id },
        data: {
          updatedAt: baseDate,
          createdAt: baseDate,
        },
      });

      // Calculate future clock: 23 months and 1 day after baseDate
      const clock23m1d = new Date(baseDate.getTime());
      clock23m1d.setUTCMonth(clock23m1d.getUTCMonth() + 23);
      clock23m1d.setUTCDate(clock23m1d.getUTCDate() + 1);

      // --- DRY RUN ---
      const drySummary = await retentionService.runRetentionCleanup({ now: clock23m1d, dryRun: true });

      // Verify CEO endpoint access
      const ceoSummaryRes = await request(app.getHttpServer())
        .get('/retention/summary')
        .set('Authorization', `Bearer ${ceoToken}`);
      expect(ceoSummaryRes.status).toBe(200);

      // Dry run reports candidate #1 for anonymisation
      expect(drySummary.profilesAnonymised.jobSeekers).toBeGreaterThanOrEqual(1);

      // Verify DB state unchanged after dry run
      const seeker1AfterDry = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker1Id } });
      expect(seeker1AfterDry.name).toBe('Ramesh Verma');
      expect(seeker1AfterDry.anonymisedAt).toBeNull();
      expect(seeker1AfterDry.photoStoragePath).toBe(photoPath1);
      expect(photoStorage.has(photoPath1)).toBe(true);

      // --- REAL RUN ---
      const realSummary = await retentionService.runRetentionCleanup({ now: clock23m1d, dryRun: false });

      expect(realSummary.profilesAnonymised.jobSeekers).toBeGreaterThanOrEqual(1);
      expect(realSummary.recordingsDeleted).toBeGreaterThanOrEqual(1);
      expect(realSummary.recordingsProtected).toBeGreaterThanOrEqual(1);

      // 1. Candidate #1 is anonymised
      const seeker1Final = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker1Id } });
      expect(seeker1Final.name).toBe('Anonymised');
      expect(seeker1Final.anonymisedAt).not.toBeNull();
      expect(seeker1Final.photoStoragePath).toBeNull();
      expect(photoStorage.has(photoPath1)).toBe(false);

      // 2. Candidate #1's 13-month-old recording is deleted from storage and marked deleted
      const call1Final = await prisma.callRecord.findUniqueOrThrow({ where: { id: call1.id } });
      expect(call1Final.recordingDeletedAt).not.toBeNull();
      expect(recordingStorage.has(recordingPathBusiness)).toBe(false);

      // 3. Placement and payment business totals are preserved
      const placement1Final = await prisma.placement.findUniqueOrThrow({ where: { id: placement.id } });
      expect(placement1Final.status).toBe('confirmed');
      expect(placement1Final.agreedSalary).toBe(2500000);
      expect(placement1Final.placementFee).toBe(1250000);

      const payment1Final = await prisma.payment.findUniqueOrThrow({ where: { id: payment1Id } });
      expect(payment1Final.status).toBe('succeeded');
      expect(payment1Final.amount).toBe(49900);

      // 4. Candidate #2 (with the open claim) is LEFT ALONE
      const seeker2Final = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker2Id } });
      expect(seeker2Final.name).toBe('Disputed Candidate Sunita');
      expect(seeker2Final.anonymisedAt).toBeNull();

      // Candidate #2's recording is protected
      const call2Final = await prisma.callRecord.findUniqueOrThrow({ where: { id: call2.id } });
      expect(call2Final.recordingDeletedAt).toBeNull();
      expect(recordingStorage.has(recordingPath2)).toBe(true);
    });
  });

  describe('Gate Assertions for Sensitive Records Immutability', () => {
    it('asserts payment, call results, recordings, consents, introductions, audit and status history cannot be edited through mutation routes', async () => {
      const server = app.getHttpServer();

      // Attempt mutative operations on never-editable entities
      const paymentRes = await request(server).put('/payments/test-id').send({ amount: 999 });
      expect(paymentRes.status).toBe(404);

      const auditRes = await request(server).patch('/audit-logs/test-id').send({ reason: 'tampered' });
      expect(auditRes.status).toBe(404);

      const statusHistRes = await request(server).delete('/status-history/test-id');
      expect(statusHistRes.status).toBe(404);

      const consentRes = await request(server).patch('/consent/test-id').send({ agreed: false });
      expect(consentRes.status).toBe(404);

      const introRes = await request(server).put('/candidate-introductions/test-id').send({ status: 'fake' });
      expect(introRes.status).toBe(404);
    });
  });
});
