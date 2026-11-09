import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  PROFILE_RETENTION_MONTHS,
  CALL_RECORDING_RETENTION_MONTHS,
  ACCESS_LOG_RETENTION_MONTHS,
  MONEY_RECORD_RETENTION_YEARS,
  getProfileRetentionCutoff,
  getCallRecordingRetentionCutoff,
  getAccessLogRetentionCutoff,
  getMoneyRecordRetentionCutoff,
} from './retention.policy';
import { RetentionService } from './retention.service';
import {
  RECORDING_STORAGE,
  MemoryRecordingStorage,
} from '../call/recording-storage';
import {
  AGREEMENT_DOCUMENT_STORAGE,
  MemoryAgreementDocumentStorage,
} from '../consent/agreement-document.storage';
import {
  CANDIDATE_PHOTO_STORAGE,
  MemoryCandidatePhotoStorage,
} from '../job-seeker/photo-storage';

describe('Phase 19 Task 3: Daily Keeping-Data Job', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let retentionService: RetentionService;
  let recordingStorage: MemoryRecordingStorage;
  let agreementStorage: MemoryAgreementDocumentStorage;
  let photoStorage: MemoryCandidatePhotoStorage;

  const claimIds: string[] = [];
  const placementIds: string[] = [];
  const vacancyIds: string[] = [];
  const bizIds: string[] = [];
  const seekerIds: string[] = [];
  const callIds: string[] = [];
  const staffIds: string[] = [];
  const sessionIds: string[] = [];
  const agreementIds: string[] = [];

  const now = new Date('2026-11-09T10:00:00.000Z');

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    retentionService = app.get(RetentionService);
    recordingStorage = app.get(RECORDING_STORAGE);
    agreementStorage = app.get(AGREEMENT_DOCUMENT_STORAGE);
    photoStorage = app.get(CANDIDATE_PHOTO_STORAGE);
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
      if (agreementIds.length) {
        await prisma.businessAgreement.deleteMany({ where: { id: { in: agreementIds } } }).catch(() => {});
      }
      if (bizIds.length) {
        await prisma.business.deleteMany({ where: { id: { in: bizIds } } }).catch(() => {});
      }
      if (seekerIds.length) {
        await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } }).catch(() => {});
      }
      if (sessionIds.length) {
        await prisma.staffSession.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => {});
      }
      if (staffIds.length) {
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }).catch(() => {});
      }
      if (app) {
        await app.close();
      }
    } finally {
      // ensured closed
    }
  });

  describe('1. Retention Policy Constants & Cutoffs', () => {
    it('defines retention periods according to Master Guide table', () => {
      expect(PROFILE_RETENTION_MONTHS).toBe(23);
      expect(CALL_RECORDING_RETENTION_MONTHS).toBe(12);
      expect(ACCESS_LOG_RETENTION_MONTHS).toBe(12);
      expect(MONEY_RECORD_RETENTION_YEARS).toBe(8);
    });

    it('calculates profile cutoff: 23m + 1d is eligible, 22m is not', () => {
      const cutoff = getProfileRetentionCutoff(now);
      const inactive23m1d = new Date(now.getTime());
      inactive23m1d.setUTCMonth(inactive23m1d.getUTCMonth() - 23);
      inactive23m1d.setUTCDate(inactive23m1d.getUTCDate() - 1);

      const inactive22m = new Date(now.getTime());
      inactive22m.setUTCMonth(inactive22m.getUTCMonth() - 22);

      expect(inactive23m1d.getTime()).toBeLessThan(cutoff.getTime());
      expect(inactive22m.getTime()).toBeGreaterThan(cutoff.getTime());
    });

    it('calculates call recording cutoff: 13m is eligible, 11m is not', () => {
      const cutoff = getCallRecordingRetentionCutoff(now);
      const rec13m = new Date(now.getTime());
      rec13m.setUTCMonth(rec13m.getUTCMonth() - 13);

      const rec11m = new Date(now.getTime());
      rec11m.setUTCMonth(rec11m.getUTCMonth() - 11);

      expect(rec13m.getTime()).toBeLessThan(cutoff.getTime());
      expect(rec11m.getTime()).toBeGreaterThan(cutoff.getTime());
    });

    it('calculates access log cutoff: 13m is eligible, 6m is not', () => {
      const cutoff = getAccessLogRetentionCutoff(now);
      const log13m = new Date(now.getTime());
      log13m.setUTCMonth(log13m.getUTCMonth() - 13);

      const log6m = new Date(now.getTime());
      log6m.setUTCMonth(log6m.getUTCMonth() - 6);

      expect(log13m.getTime()).toBeLessThan(cutoff.getTime());
      expect(log6m.getTime()).toBeGreaterThan(cutoff.getTime());
    });

    it('calculates money records cutoff: 8y + 1d is eligible, 7y is not', () => {
      const cutoff = getMoneyRecordRetentionCutoff(now);
      const money8y1d = new Date(now.getTime());
      money8y1d.setUTCFullYear(money8y1d.getUTCFullYear() - 8);
      money8y1d.setUTCDate(money8y1d.getUTCDate() - 1);

      const money7y = new Date(now.getTime());
      money7y.setUTCFullYear(money7y.getUTCFullYear() - 7);

      expect(money8y1d.getTime()).toBeLessThan(cutoff.getTime());
      expect(money7y.getTime()).toBeGreaterThan(cutoff.getTime());
    });
  });

  describe('2. Profiles Cleanup (23 months)', () => {
    it('anonymises job seeker inactive for 23m+1d, leaves 22m inactive untouched', async () => {
      const stamp = Date.now();
      const photoPathOld = `candidates/retention-old-${stamp}.jpg`;
      await photoStorage.put(photoPathOld, Buffer.from('old-photo'), 'image/jpeg');

      const date23m1d = new Date(now.getTime());
      date23m1d.setUTCMonth(date23m1d.getUTCMonth() - 23);
      date23m1d.setUTCDate(date23m1d.getUTCDate() - 1);

      const date22m = new Date(now.getTime());
      date22m.setUTCMonth(date22m.getUTCMonth() - 22);

      // Candidate 1: Inactive > 23m
      const jsOld = await prisma.jobSeeker.create({
        data: {
          code: `JS-RET1-${stamp}`,
          name: 'Inactive Candidate Old',
          phone: `+91991000${stamp.toString().slice(-4)}`,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          minSalary: 1500000,
          maxSalary: 2500000,
          photoStoragePath: photoPathOld,
          createdAt: date23m1d,
          updatedAt: date23m1d,
        },
      });
      seekerIds.push(jsOld.id);

      // Candidate 2: Inactive only 22m
      const jsRecent = await prisma.jobSeeker.create({
        data: {
          code: `JS-RET2-${stamp}`,
          name: 'Active Candidate Recent',
          phone: `+91992000${stamp.toString().slice(-4)}`,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          minSalary: 1500000,
          maxSalary: 2500000,
          createdAt: date22m,
          updatedAt: date22m,
        },
      });
      seekerIds.push(jsRecent.id);

      const summary = await retentionService.runRetentionCleanup({ now, dryRun: false });

      expect(summary.profilesAnonymised.jobSeekers).toBeGreaterThanOrEqual(1);

      // Verify jsOld was anonymised
      const jsOldAfter = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: jsOld.id } });
      expect(jsOldAfter.name).toBe('Anonymised');
      expect(jsOldAfter.anonymisedAt).not.toBeNull();
      expect(jsOldAfter.photoStoragePath).toBeNull();
      expect(photoStorage.has(photoPathOld)).toBe(false);

      // Verify jsRecent was NOT anonymised
      const jsRecentAfter = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: jsRecent.id } });
      expect(jsRecentAfter.name).toBe('Active Candidate Recent');
      expect(jsRecentAfter.anonymisedAt).toBeNull();
    });

    it('recent call resets the clock for a 24-month-old job seeker', async () => {
      const stamp = Date.now();
      const date24m = new Date(now.getTime());
      date24m.setUTCMonth(date24m.getUTCMonth() - 24);

      const recentCallDate = new Date(now.getTime());
      recentCallDate.setUTCMonth(recentCallDate.getUTCMonth() - 1);

      const jsWithCall = await prisma.jobSeeker.create({
        data: {
          code: `JS-RETCALL-${stamp}`,
          name: 'Old Candidate With Recent Call',
          phone: `+91993000${stamp.toString().slice(-4)}`,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          minSalary: 1500000,
          maxSalary: 2500000,
          createdAt: date24m,
          updatedAt: date24m,
        },
      });
      seekerIds.push(jsWithCall.id);

      const recentCall = await prisma.callRecord.create({
        data: {
          code: `CR-RET-${stamp}`,
          provider: 'mock',
          providerCallId: `call-${stamp}`,
          providerStatus: 'completed',
          subjectType: 'job_seeker',
          subjectId: jsWithCall.id,
          startedAt: recentCallDate,
          createdAt: recentCallDate,
        },
      });
      callIds.push(recentCall.id);

      await retentionService.runRetentionCleanup({ now, dryRun: false });

      const jsAfter = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: jsWithCall.id } });
      expect(jsAfter.name).toBe('Old Candidate With Recent Call');
      expect(jsAfter.anonymisedAt).toBeNull();
    });
  });

  describe('3. Call Recordings Cleanup (12 months)', () => {
    it('deletes 13-month recording, but preserves 13-month recording linked to open claim', async () => {
      const stamp = Date.now();
      const date13m = new Date(now.getTime());
      date13m.setUTCMonth(date13m.getUTCMonth() - 13);

      const recPathUnprotected = `recordings/call-unprotected-${stamp}.mp3`;
      const recPathProtected = `recordings/call-protected-${stamp}.mp3`;

      await recordingStorage.put(recPathUnprotected, Buffer.from('unprotected-audio'), 'audio/mpeg');
      await recordingStorage.put(recPathProtected, Buffer.from('protected-audio'), 'audio/mpeg');

      // Unprotected 13m call
      const callUnprotected = await prisma.callRecord.create({
        data: {
          code: `CR-DEL-${stamp}`,
          provider: 'mock',
          providerCallId: `call-del-${stamp}`,
          providerStatus: 'completed',
          startedAt: date13m,
          createdAt: date13m,
          recordingStoragePath: recPathUnprotected,
        },
      });
      callIds.push(callUnprotected.id);

      // Protected 13m call linked to open claim
      const candidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-CLM-${stamp}`,
          name: 'Claim Candidate',
          phone: `+91994000${stamp.toString().slice(-4)}`,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          minSalary: 1500000,
          maxSalary: 2500000,
        },
      });
      seekerIds.push(candidate.id);

      const biz = await prisma.business.create({
        data: {
          code: `BZ-CLM-${stamp}`,
          name: 'Claim Biz',
          phone: `+91995000${stamp.toString().slice(-4)}`,
          ownerName: 'Owner',
        },
      });
      bizIds.push(biz.id);

      const vacancy = await prisma.vacancy.create({
        data: {
          code: `VC-CLM-${stamp}`,
          businessId: biz.id,
          tradeSkill: 'Security',
          salaryMinPaise: 1500000,
          salaryMaxPaise: 2500000,
          headcount: 1,
        },
      });
      vacancyIds.push(vacancy.id);

      const placement = await prisma.placement.create({
        data: {
          code: `PL-CLM-${stamp}`,
          jobSeekerId: candidate.id,
          businessId: biz.id,
          vacancyId: vacancy.id,
          status: 'dropped_out',
          agreedSalary: 2000000,
          placementFee: 1000000,
          gstAmount: 180000,
        },
      });
      placementIds.push(placement.id);

      const callProtected = await prisma.callRecord.create({
        data: {
          code: `CR-PROT-${stamp}`,
          provider: 'mock',
          providerCallId: `call-prot-${stamp}`,
          providerStatus: 'completed',
          startedAt: date13m,
          createdAt: date13m,
          recordingStoragePath: recPathProtected,
          relatedType: 'placement',
          relatedId: placement.id,
        },
      });
      callIds.push(callProtected.id);

      const claim = await prisma.replacementClaim.create({
        data: {
          code: `RC-CLM-${stamp}`,
          placementId: placement.id,
          workerLeftOn: new Date(),
          reportedWithinDeadline: true,
          feePaidInFull: true,
          reason: 'candidate_absconded',
          decision: null, // OPEN claim!
          decisionDueAt: new Date(now.getTime() + 86400000),
          callRecordId: callProtected.id,
        },
      });
      claimIds.push(claim.id);

      const summary = await retentionService.runRetentionCleanup({ now, dryRun: false });

      expect(summary.recordingsDeleted).toBeGreaterThanOrEqual(1);
      expect(summary.recordingsProtected).toBeGreaterThanOrEqual(1);

      // Unprotected: file deleted and recordingDeletedAt set
      const callUnprotectedAfter = await prisma.callRecord.findUniqueOrThrow({
        where: { id: callUnprotected.id },
      });
      expect(callUnprotectedAfter.recordingDeletedAt).not.toBeNull();
      expect(recordingStorage.has(recPathUnprotected)).toBe(false);

      // Protected: file preserved and recordingDeletedAt remains null
      const callProtectedAfter = await prisma.callRecord.findUniqueOrThrow({
        where: { id: callProtected.id },
      });
      expect(callProtectedAfter.recordingDeletedAt).toBeNull();
      expect(recordingStorage.has(recPathProtected)).toBe(true);
    });
  });

  describe('4. Login & Access Logs Cleanup (12 months)', () => {
    it('deletes sessions older than 12 months, keeps recent sessions', async () => {
      const stamp = Date.now();
      const date13m = new Date(now.getTime());
      date13m.setUTCMonth(date13m.getUTCMonth() - 13);

      const date1m = new Date(now.getTime());
      date1m.setUTCMonth(date1m.getUTCMonth() - 1);

      const staff = await prisma.staff.create({
        data: {
          code: `ST-LOG-${stamp}`,
          name: 'Log Staff',
          role: 'call_agent',
          passwordHash: 'dummy-hash',
        },
      });
      staffIds.push(staff.id);

      const oldSession = await prisma.staffSession.create({
        data: {
          staffId: staff.id,
          expiresAt: date13m,
          absoluteExpiresAt: date13m,
          createdAt: date13m,
        },
      });
      sessionIds.push(oldSession.id);

      const recentSession = await prisma.staffSession.create({
        data: {
          staffId: staff.id,
          expiresAt: date1m,
          absoluteExpiresAt: date1m,
          createdAt: date1m,
        },
      });
      sessionIds.push(recentSession.id);

      const summary = await retentionService.runRetentionCleanup({ now, dryRun: false });

      expect(summary.accessLogsDeleted.sessions).toBeGreaterThanOrEqual(1);

      const oldSessionAfter = await prisma.staffSession.findUnique({
        where: { id: oldSession.id },
      });
      expect(oldSessionAfter).toBeNull();

      const recentSessionAfter = await prisma.staffSession.findUnique({
        where: { id: recentSession.id },
      });
      expect(recentSessionAfter).not.toBeNull();
    });
  });

  describe('5. Dry Run Mode', () => {
    it('dry run reports counts without deleting or modifying any records or files', async () => {
      const stamp = Date.now();
      const date24m = new Date(now.getTime());
      date24m.setUTCMonth(date24m.getUTCMonth() - 24);

      const photoPath = `candidates/dryrun-${stamp}.jpg`;
      await photoStorage.put(photoPath, Buffer.from('dryrun-photo'), 'image/jpeg');

      const js = await prisma.jobSeeker.create({
        data: {
          code: `JS-DRY-${stamp}`,
          name: 'Dry Run Candidate',
          phone: `+91997000${stamp.toString().slice(-4)}`,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          minSalary: 1500000,
          maxSalary: 2500000,
          photoStoragePath: photoPath,
          createdAt: date24m,
          updatedAt: date24m,
        },
      });
      seekerIds.push(js.id);

      const recPath = `recordings/dryrun-${stamp}.mp3`;
      await recordingStorage.put(recPath, Buffer.from('dryrun-audio'), 'audio/mpeg');

      const call = await prisma.callRecord.create({
        data: {
          code: `CR-DRY-${stamp}`,
          provider: 'mock',
          providerCallId: `call-dry-${stamp}`,
          providerStatus: 'completed',
          startedAt: date24m,
          createdAt: date24m,
          recordingStoragePath: recPath,
        },
      });
      callIds.push(call.id);

      const summary = await retentionService.runRetentionCleanup({ now, dryRun: true });

      expect(summary.dryRun).toBe(true);
      expect(summary.profilesAnonymised.jobSeekers).toBeGreaterThanOrEqual(1);
      expect(summary.recordingsDeleted).toBeGreaterThanOrEqual(1);

      // Verify NOTHING changed in DB or storage
      const jsAfter = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: js.id } });
      expect(jsAfter.name).toBe('Dry Run Candidate');
      expect(jsAfter.anonymisedAt).toBeNull();
      expect(photoStorage.has(photoPath)).toBe(true);

      const callAfter = await prisma.callRecord.findUniqueOrThrow({ where: { id: call.id } });
      expect(callAfter.recordingDeletedAt).toBeNull();
      expect(recordingStorage.has(recPath)).toBe(true);
    });
  });

  describe('6. Idempotency', () => {
    it('running retention job consecutively is safe and produces consistent state', async () => {
      const summary1 = await retentionService.runRetentionCleanup({ now, dryRun: false });
      expect(summary1.dryRun).toBe(false);

      // Running immediately again should see 0 newly eligible candidates
      const summary2 = await retentionService.runRetentionCleanup({ now, dryRun: false });
      expect(summary2.profilesAnonymised.jobSeekers).toBe(0);
      expect(summary2.recordingsDeleted).toBe(0);
    });
  });

  describe('7. Money Records Retention (8 years)', () => {
    it('deletes signed agreement documents and rows older than 8 years', async () => {
      const stamp = Date.now();
      const date9y = new Date(now.getTime());
      date9y.setUTCFullYear(date9y.getUTCFullYear() - 9);

      const agreementPath = `agreements/ag-9y-${stamp}.pdf`;
      await agreementStorage.put(agreementPath, Buffer.from('signed-terms'), 'application/pdf');

      const biz = await prisma.business.create({
        data: {
          code: `BZ-AG9-${stamp}`,
          name: 'Old Agreement Biz',
          phone: `+91998000${stamp.toString().slice(-4)}`,
        },
      });
      bizIds.push(biz.id);

      const agreement = await prisma.businessAgreement.create({
        data: {
          businessId: biz.id,
          version: '1.0',
          termsHash: 'hash-9y',
          noBypassMonths: 12,
          noBypassPenaltyPercent: 50,
          feePercent: 50,
          gstPercent: 18,
          signedName: 'Owner',
          signedPhone: '+919980000000',
          otpRequestId: `otp-${stamp}`,
          signedAt: date9y,
          documentStoragePath: agreementPath,
          createdAt: date9y,
        },
      });
      agreementIds.push(agreement.id);

      await retentionService.runRetentionCleanup({ now, dryRun: false });

      expect(agreementStorage.has(agreementPath)).toBe(false);
      const agAfter = await prisma.businessAgreement.findUnique({
        where: { id: agreement.id },
      });
      expect(agAfter).toBeNull();
    });
  });

  describe('8. CEO Summary Access', () => {
    it('stores run summary in JobRun and getLatestSummary retrieves it', async () => {
      await retentionService.runRetentionCleanup({ now, dryRun: false });
      const latest = await retentionService.getLatestSummary();

      expect(latest).not.toBeNull();
      expect(latest?.executedAt).toBeInstanceOf(Date);
      expect(latest?.profilesAnonymised).toBeDefined();
      expect(latest?.recordingsDeleted).toBeDefined();
      expect(latest?.accessLogsDeleted).toBeDefined();
      expect(latest?.moneyRecordsDeleted).toBeDefined();
    });
  });
});
