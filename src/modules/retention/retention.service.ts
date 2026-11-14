import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { BUSINESS_PHOTO_STORAGE, BusinessPhotoStorage } from '../business/storefront-photo.storage';
import { AadhaarQrPhotoService } from '../aadhaar-qr/aadhaar-qr-photo.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnonymisationService } from '../../common/anonymisation/anonymisation.service';
import {
  RECORDING_STORAGE,
  RecordingStorage,
} from '../call/recording-storage';
import {
  AGREEMENT_DOCUMENT_STORAGE,
  AgreementDocumentStorage,
} from '../consent/agreement-document.storage';
import {
  getAccessLogRetentionCutoff,
  getCallRecordingRetentionCutoff,
  getMoneyRecordRetentionCutoff,
  getProfileRetentionCutoff,
  JOB_RUN_RETENTION_DAYS,
  TRANSIENT_LINK_RETENTION_DAYS,
} from './retention.policy';

/** What still identifies an unregistered shop or a person on a visit (T2). */
const SHOP_VISIT_PERSONAL = [
  { contactPhone: { not: null } },
  { boardPhotoPath: { not: null } },
  { boardPhotoHash: { not: null } },
  { selfieUrl: { not: null } },
  { selfieHash: { not: null } },
  { shopName: { not: null } },
  { note: { not: null } },
  { proofLatitude: { not: null } },
  { latitude: { not: 0 } },
];

function hasShopVisitPersonal(v: {
  contactPhone: string | null;
  boardPhotoPath: string | null;
  boardPhotoHash: string | null;
  selfieUrl: string | null;
  selfieHash: string | null;
  shopName: string | null;
  note: string | null;
  latitude: number;
  longitude: number;
  proofLatitude: number | null;
}): boolean {
  return Boolean(v.contactPhone || v.boardPhotoPath || v.boardPhotoHash || v.selfieUrl || v.selfieHash || v.shopName || v.note || v.proofLatitude !== null || v.latitude !== 0 || v.longitude !== 0);
}

export interface RetentionSummary {
  executedAt: Date;
  dryRun: boolean;
  profilesAnonymised: {
    jobSeekers: number;
    businesses: number;
    referrals: number;
    total: number;
    refused: number;
  };
  recordingsDeleted: number;
  recordingsProtected: number;
  accessLogsDeleted: {
    sessions: number;
    loginCodeRequests: number;
    total: number;
  };
  moneyRecordsDeleted: {
    payments: number;
    bankCredits: number;
    agreements: number;
    total: number;
  };
  publicLinksDeleted: number;
  otpSessionsDeleted: number;
  /** JobRun rows older than 90 days (each job's latest run is kept). */
  jobRunsDeleted: number;
  /** Visits to shops that never registered, 23 months after the shop's last visit: phone and photos removed, the visit kept. */
  shopVisitsCleaned: number;
  /** Visit photos whose storage delete failed this run: their paths stay for the next run (T1). */
  shopVisitPhotoDeleteFailures: number;
  /** Aadhaar QR photos past their 30 days (the Team Lead never completed the check). */
  aadhaarQrPhotosDeleted: number;
}

export interface RetentionRunOptions {
  dryRun?: boolean;
  now?: Date;
}

export const RETENTION_JOB_NAME = 'retention-cleanup';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anonymisationService: AnonymisationService,
    @Inject(RECORDING_STORAGE)
    private readonly recordingStorage: RecordingStorage,
    @Inject(AGREEMENT_DOCUMENT_STORAGE)
    private readonly agreementStorage: AgreementDocumentStorage,
    @Optional() @Inject(BUSINESS_PHOTO_STORAGE)
    private readonly visitPhotos?: BusinessPhotoStorage,
    @Optional() private readonly aadhaarQrPhotos?: AadhaarQrPhotoService,
  ) {}

  async runRetentionCleanup(options: RetentionRunOptions = {}): Promise<RetentionSummary> {
    const now = options.now ?? new Date();
    const dryRun = options.dryRun ?? false;
    const startedAt = new Date();

    const summary: RetentionSummary = {
      executedAt: now,
      dryRun,
      profilesAnonymised: {
        jobSeekers: 0,
        businesses: 0,
        referrals: 0,
        total: 0,
        refused: 0,
      },
      recordingsDeleted: 0,
      recordingsProtected: 0,
      accessLogsDeleted: {
        sessions: 0,
        loginCodeRequests: 0,
        total: 0,
      },
      moneyRecordsDeleted: {
        payments: 0,
        bankCredits: 0,
        agreements: 0,
        total: 0,
      },
      publicLinksDeleted: 0,
      otpSessionsDeleted: 0,
      jobRunsDeleted: 0,
      shopVisitsCleaned: 0,
      shopVisitPhotoDeleteFailures: 0,
      aadhaarQrPhotosDeleted: 0,
    };

    try {
      // 1. Profiles (> 23 months inactive)
      await this.cleanupProfiles(now, dryRun, summary);

      // 2. Call recordings (> 12 months)
      await this.cleanupRecordings(now, dryRun, summary);

      // 3. Login and access logs (> 12 months)
      await this.cleanupAccessLogs(now, dryRun, summary);

      // 4. Money records (> 8 years)
      await this.cleanupMoneyRecords(now, dryRun, summary);

      // 5. Public links and OTP sessions (> 30 days after expiry)
      await this.cleanupExpiredLinkData(now, dryRun, summary);

      // 6. The job run log itself (> 90 days, keeping each job's latest run)
      await this.cleanupJobRuns(now, dryRun, summary);

      // 7. Visits to shops that never registered (> 23 months after the shop's last visit)
      await this.cleanupUnregisteredShopVisits(now, dryRun, summary);

      // 8. Aadhaar QR photos the Team Lead never checked (> 30 days; guide, 14 Nov)
      if (this.aadhaarQrPhotos) summary.aadhaarQrPhotosDeleted = await this.aadhaarQrPhotos.deleteExpiredPhotos(now, dryRun);
    } catch (err: unknown) {
      // A run that fails part-way is recorded too (start, finish, error), like every scheduled job.
      try {
        await this.prisma.jobRun.create({
          data: {
            jobName: RETENTION_JOB_NAME,
            startedAt,
            finishedAt: new Date(),
            outcome: 'failed',
            details: { dryRun, error: err instanceof Error ? err.message : String(err) },
          },
        });
      } catch (logErr: unknown) {
        this.logger.warn(`Failed to store retention cleanup JobRun: ${logErr instanceof Error ? logErr.message : String(logErr)}`);
      }
      throw err;
    }

    // Persist run summary in JobRun
    try {
      await this.prisma.jobRun.create({
        data: {
          jobName: RETENTION_JOB_NAME,
          startedAt,
          finishedAt: new Date(),
          outcome: 'success',
          evaluated:
            summary.profilesAnonymised.total +
            summary.recordingsDeleted +
            summary.accessLogsDeleted.total +
            summary.moneyRecordsDeleted.total +
            summary.publicLinksDeleted +
            summary.otpSessionsDeleted +
            summary.jobRunsDeleted +
            summary.shopVisitsCleaned +
            summary.aadhaarQrPhotosDeleted,
          hitsRecorded: 0,
          details: {
            executedAt: summary.executedAt.toISOString(),
            dryRun: summary.dryRun,
            profilesAnonymised: summary.profilesAnonymised,
            recordingsDeleted: summary.recordingsDeleted,
            recordingsProtected: summary.recordingsProtected,
            accessLogsDeleted: summary.accessLogsDeleted,
            moneyRecordsDeleted: summary.moneyRecordsDeleted,
            publicLinksDeleted: summary.publicLinksDeleted,
            otpSessionsDeleted: summary.otpSessionsDeleted,
            jobRunsDeleted: summary.jobRunsDeleted,
            shopVisitsCleaned: summary.shopVisitsCleaned,
            shopVisitPhotoDeleteFailures: summary.shopVisitPhotoDeleteFailures,
            aadhaarQrPhotosDeleted: summary.aadhaarQrPhotosDeleted,
          },
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to store retention cleanup JobRun: ${msg}`);
    }

    return summary;
  }

  async getLatestSummary(): Promise<RetentionSummary | null> {
    const latest = await this.prisma.jobRun.findFirst({
      where: {
        jobName: RETENTION_JOB_NAME,
        outcome: 'success',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest?.details) return null;
    const details = latest.details as Record<string, unknown>;
    return {
      executedAt: new Date(details.executedAt as string),
      dryRun: Boolean(details.dryRun),
      profilesAnonymised: details.profilesAnonymised as RetentionSummary['profilesAnonymised'],
      recordingsDeleted: Number(details.recordingsDeleted),
      recordingsProtected: Number(details.recordingsProtected),
      accessLogsDeleted: details.accessLogsDeleted as RetentionSummary['accessLogsDeleted'],
      moneyRecordsDeleted: details.moneyRecordsDeleted as RetentionSummary['moneyRecordsDeleted'],
      publicLinksDeleted: Number(details.publicLinksDeleted ?? 0),
      otpSessionsDeleted: Number(details.otpSessionsDeleted ?? 0),
      jobRunsDeleted: Number(details.jobRunsDeleted ?? 0),
      shopVisitsCleaned: Number(details.shopVisitsCleaned ?? 0),
      shopVisitPhotoDeleteFailures: Number(details.shopVisitPhotoDeleteFailures ?? 0),
      aadhaarQrPhotosDeleted: Number(details.aadhaarQrPhotosDeleted ?? 0),
    };
  }

  /**
   * Guide, retention (11 Nov): visits to shops that never registered (shop
   * name, shop phone, name-board photo, proof selfie) are kept like business
   * profiles — 23 months after the last visit to that shop, then the shop
   * phone and photos are removed and only the visit counts stay. A shop is a
   * chain of visits linked by revisitOfVisitId; a chain where any visit
   * registered the business, or any visit is newer than the cutoff, is kept.
   */
  async cleanupUnregisteredShopVisits(
    now: Date,
    dryRun: boolean,
    summary: Pick<RetentionSummary, 'shopVisitsCleaned'> & Partial<Pick<RetentionSummary, 'shopVisitPhotoDeleteFailures'>>,
  ): Promise<void> {
    const cutoff = getProfileRetentionCutoff(now);
    const candidates = await this.prisma.businessVisit.findMany({
      where: { businessId: null, visitedAt: { lt: cutoff }, OR: SHOP_VISIT_PERSONAL },
      select: { id: true },
      take: 5000,
    });
    const settled = new Set<string>();
    for (const { id } of candidates) {
      if (settled.has(id)) continue;
      const chain = await this.visitChain(id);
      chain.forEach((v) => settled.add(v.id));
      if (chain.some((v) => v.businessId !== null || v.visitedAt >= cutoff)) continue;
      const toClean = chain.filter(hasShopVisitPersonal);
      if (dryRun) {
        summary.shopVisitsCleaned += toClean.length;
        continue;
      }
      for (const visit of toClean) {
        // T1: a photo path (and its hash) is cleared only once its file is deleted;
        // a failed delete stays for the next run and is counted.
        const keep: { boardPhotoPath?: string; boardPhotoHash?: string | null; selfieUrl?: string; selfieHash?: string | null } = {};
        for (const [pathKey, hashKey] of [['boardPhotoPath', 'boardPhotoHash'], ['selfieUrl', 'selfieHash']] as const) {
          const path = visit[pathKey];
          if (!path) continue;
          let deleted = false;
          if (this.visitPhotos?.delete) {
            try {
              await this.visitPhotos.delete(path);
              deleted = true;
            } catch (err: unknown) {
              this.logger.warn(`Visit photo ${visit.id} could not be deleted: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          if (!deleted) {
            keep[pathKey] = path;
            keep[hashKey] = visit[hashKey];
            summary.shopVisitPhotoDeleteFailures = (summary.shopVisitPhotoDeleteFailures ?? 0) + 1;
          }
        }
        // T2: only the visit itself is kept (it counts in the visit totals): no
        // shop name, note, phone, GPS or photo fingerprints.
        const cleaned = await this.prisma.businessVisit.updateMany({
          where: { id: visit.id, businessId: null },
          data: {
            contactPhone: null,
            shopName: null,
            note: null,
            latitude: 0,
            longitude: 0,
            accuracyMeters: null,
            proofLatitude: null,
            proofLongitude: null,
            proofAccuracyMeters: null,
            proofDistanceMeters: null,
            boardPhotoPath: null,
            boardPhotoHash: null,
            selfieUrl: null,
            selfieHash: null,
            ...keep,
          },
        });
        summary.shopVisitsCleaned += cleaned.count;
      }
    }
  }

  /** Every visit to the same shop: up to the first visit, then every revisit after it. */
  private async visitChain(id: string) {
    const select = {
      id: true,
      businessId: true,
      visitedAt: true,
      contactPhone: true,
      boardPhotoPath: true,
      boardPhotoHash: true,
      selfieUrl: true,
      selfieHash: true,
      shopName: true,
      note: true,
      latitude: true,
      longitude: true,
      proofLatitude: true,
      revisitOfVisitId: true,
    } as const;
    let root = await this.prisma.businessVisit.findUnique({ where: { id }, select });
    const seen = new Set<string>();
    while (root?.revisitOfVisitId && !seen.has(root.id)) {
      seen.add(root.id);
      const parent = await this.prisma.businessVisit.findUnique({ where: { id: root.revisitOfVisitId }, select });
      if (!parent) break;
      root = parent;
    }
    if (!root) return [];
    const chain = [root];
    let frontier = [root.id];
    const inChain = new Set([root.id]);
    while (frontier.length) {
      const next = await this.prisma.businessVisit.findMany({ where: { revisitOfVisitId: { in: frontier } }, select });
      frontier = [];
      for (const v of next) {
        if (inChain.has(v.id)) continue;
        inChain.add(v.id);
        chain.push(v);
        frontier.push(v.id);
      }
    }
    return chain;
  }

  /**
   * Deletes JobRun rows older than JOB_RUN_RETENTION_DAYS. Each job's latest
   * run is kept whatever its age, so "last ran" on System Health and the
   * stale-sweep alerts still know when a job last ran.
   */
  private async cleanupJobRuns(now: Date, dryRun: boolean, summary: RetentionSummary): Promise<void> {
    const cutoff = new Date(now.getTime() - JOB_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const latest = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON ("jobName") "id" FROM "JobRun" ORDER BY "jobName", "createdAt" DESC, "id" DESC`;
    const where = { createdAt: { lt: cutoff }, id: { notIn: latest.map((row) => row.id) } };
    if (dryRun) {
      summary.jobRunsDeleted = await this.prisma.jobRun.count({ where });
      return;
    }
    const deleted = await this.prisma.jobRun.deleteMany({ where });
    summary.jobRunsDeleted = deleted.count;
  }

  private async cleanupExpiredLinkData(now: Date, dryRun: boolean, summary: RetentionSummary): Promise<void> {
    const cutoff = new Date(now.getTime() - TRANSIENT_LINK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    if (dryRun) {
      const [links, sessions] = await Promise.all([
        this.prisma.publicLink.count({ where: { expiresAt: { lt: cutoff } } }),
        this.prisma.otpSession.count({ where: { expiresAt: { lt: cutoff } } }),
      ]);
      summary.publicLinksDeleted = links;
      summary.otpSessionsDeleted = sessions;
      return;
    }
    const [links, sessions] = await this.prisma.$transaction([
      this.prisma.publicLink.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
      this.prisma.otpSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    ]);
    summary.publicLinksDeleted = links.count;
    summary.otpSessionsDeleted = sessions.count;
  }

  private async cleanupProfiles(
    now: Date,
    dryRun: boolean,
    summary: RetentionSummary,
  ): Promise<void> {
    const cutoff = getProfileRetentionCutoff(now);

    // 1.1 Job Seekers
    const candidates = await this.prisma.jobSeeker.findMany({
      where: {
        anonymisedAt: null,
      },
      select: {
        id: true,
        code: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    for (const js of candidates) {
      const isInactive = await this.isJobSeekerInactive(js.id, js.createdAt, js.updatedAt, cutoff);
      if (!isInactive) continue;

      if (dryRun) {
        const check = await this.anonymisationService.canAnonymise('job_seeker', js.id);
        if (check.allowed) {
          summary.profilesAnonymised.jobSeekers++;
          summary.profilesAnonymised.total++;
        } else {
          summary.profilesAnonymised.refused++;
        }
      } else {
        try {
          await this.anonymisationService.anonymise(
            'job_seeker',
            js.id,
            'Retention policy: inactive for > 23 months',
          );
          summary.profilesAnonymised.jobSeekers++;
          summary.profilesAnonymised.total++;
        } catch {
          summary.profilesAnonymised.refused++;
        }
      }
    }

    // 1.2 Businesses
    const businesses = await this.prisma.business.findMany({
      where: {
        anonymisedAt: null,
      },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    for (const bz of businesses) {
      const isInactive = await this.isBusinessInactive(bz.id, bz.createdAt, bz.updatedAt, cutoff);
      if (!isInactive) continue;

      if (dryRun) {
        const check = await this.anonymisationService.canAnonymise('business', bz.id);
        if (check.allowed) {
          summary.profilesAnonymised.businesses++;
          summary.profilesAnonymised.total++;
        } else {
          summary.profilesAnonymised.refused++;
        }
      } else {
        try {
          await this.anonymisationService.anonymise(
            'business',
            bz.id,
            'Retention policy: inactive for > 23 months',
          );
          summary.profilesAnonymised.businesses++;
          summary.profilesAnonymised.total++;
        } catch {
          summary.profilesAnonymised.refused++;
        }
      }
    }

    // 1.3 Referrals
    const referrals = await this.prisma.referral.findMany({
      where: {
        anonymisedAt: null,
      },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    for (const ref of referrals) {
      const isInactive = await this.isReferralInactive(ref.id, ref.createdAt, ref.updatedAt, cutoff);
      if (!isInactive) continue;

      if (dryRun) {
        const check = await this.anonymisationService.canAnonymise('referral', ref.id);
        if (check.allowed) {
          summary.profilesAnonymised.referrals++;
          summary.profilesAnonymised.total++;
        } else {
          summary.profilesAnonymised.refused++;
        }
      } else {
        try {
          await this.anonymisationService.anonymise(
            'referral',
            ref.id,
            'Retention policy: inactive for > 23 months',
          );
          summary.profilesAnonymised.referrals++;
          summary.profilesAnonymised.total++;
        } catch {
          summary.profilesAnonymised.refused++;
        }
      }
    }
  }

  private async isJobSeekerInactive(
    id: string,
    createdAt: Date,
    updatedAt: Date,
    cutoff: Date,
  ): Promise<boolean> {
    if (createdAt > cutoff || updatedAt > cutoff) return false;

    // Check calls
    const recentCall = await this.prisma.callRecord.findFirst({
      where: {
        subjectType: 'job_seeker',
        subjectId: id,
        OR: [{ startedAt: { gt: cutoff } }, { createdAt: { gt: cutoff } }],
      },
      select: { id: true },
    });
    if (recentCall) return false;

    // Check messages
    const recentMessage = await this.prisma.messageLog.findFirst({
      where: {
        subjectType: 'job_seeker',
        subjectId: id,
        OR: [{ sentAt: { gt: cutoff } }, { createdAt: { gt: cutoff } }],
      },
      select: { id: true },
    });
    if (recentMessage) return false;

    // Check interviews
    const recentInterview = await this.prisma.interview.findFirst({
      where: {
        jobSeekerId: id,
        OR: [
          { slotStartsAt: { gt: cutoff } },
          { offerSentAt: { gt: cutoff } },
          { updatedAt: { gt: cutoff } },
          { createdAt: { gt: cutoff } },
        ],
      },
      select: { id: true },
    });
    if (recentInterview) return false;

    // Check placements
    const recentPlacement = await this.prisma.placement.findFirst({
      where: {
        jobSeekerId: id,
        OR: [{ updatedAt: { gt: cutoff } }, { createdAt: { gt: cutoff } }],
      },
      select: { id: true },
    });
    if (recentPlacement) return false;

    // Check consent
    const recentConsent = await this.prisma.consent.findFirst({
      where: {
        subjectType: 'job_seeker',
        subjectId: id,
        OR: [
          { grantedAt: { gt: cutoff } },
          { withdrawnAt: { gt: cutoff } },
          { updatedAt: { gt: cutoff } },
          { createdAt: { gt: cutoff } },
        ],
      },
      select: { id: true },
    });
    if (recentConsent) return false;

    // Check payments
    const recentPayment = await this.prisma.payment.findFirst({
      where: {
        AND: [
          {
            OR: [
              { jobSeekerId: id },
              { subjectType: 'job_seeker', subjectId: id },
            ],
          },
          {
            OR: [
              { updatedAt: { gt: cutoff } },
              { createdAt: { gt: cutoff } },
              { confirmedAt: { gt: cutoff } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    if (recentPayment) return false;

    return true;
  }

  private async isBusinessInactive(
    id: string,
    createdAt: Date,
    updatedAt: Date,
    cutoff: Date,
  ): Promise<boolean> {
    if (createdAt > cutoff || updatedAt > cutoff) return false;

    // Check calls
    const recentCall = await this.prisma.callRecord.findFirst({
      where: {
        subjectType: 'business',
        subjectId: id,
        OR: [{ startedAt: { gt: cutoff } }, { createdAt: { gt: cutoff } }],
      },
      select: { id: true },
    });
    if (recentCall) return false;

    // Check messages
    const recentMessage = await this.prisma.messageLog.findFirst({
      where: {
        subjectType: 'business',
        subjectId: id,
        OR: [{ sentAt: { gt: cutoff } }, { createdAt: { gt: cutoff } }],
      },
      select: { id: true },
    });
    if (recentMessage) return false;

    // Check placements
    const recentPlacement = await this.prisma.placement.findFirst({
      where: {
        businessId: id,
        OR: [{ updatedAt: { gt: cutoff } }, { createdAt: { gt: cutoff } }],
      },
      select: { id: true },
    });
    if (recentPlacement) return false;

    // Check consents
    const recentConsent = await this.prisma.consent.findFirst({
      where: {
        subjectType: 'business',
        subjectId: id,
        OR: [
          { grantedAt: { gt: cutoff } },
          { withdrawnAt: { gt: cutoff } },
          { updatedAt: { gt: cutoff } },
          { createdAt: { gt: cutoff } },
        ],
      },
      select: { id: true },
    });
    if (recentConsent) return false;

    // Check payments
    const recentPayment = await this.prisma.payment.findFirst({
      where: {
        AND: [
          {
            OR: [
              { businessId: id },
              { subjectType: 'business', subjectId: id },
            ],
          },
          {
            OR: [
              { updatedAt: { gt: cutoff } },
              { createdAt: { gt: cutoff } },
              { confirmedAt: { gt: cutoff } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    if (recentPayment) return false;

    return true;
  }

  private async isReferralInactive(
    id: string,
    createdAt: Date,
    updatedAt: Date,
    cutoff: Date,
  ): Promise<boolean> {
    if (createdAt > cutoff || updatedAt > cutoff) return false;

    // Check calls
    const recentCall = await this.prisma.callRecord.findFirst({
      where: {
        subjectType: 'referral',
        subjectId: id,
        OR: [{ startedAt: { gt: cutoff } }, { createdAt: { gt: cutoff } }],
      },
      select: { id: true },
    });
    if (recentCall) return false;

    // Check consents
    const recentConsent = await this.prisma.consent.findFirst({
      where: {
        subjectType: 'referral',
        subjectId: id,
        OR: [
          { grantedAt: { gt: cutoff } },
          { withdrawnAt: { gt: cutoff } },
          { updatedAt: { gt: cutoff } },
          { createdAt: { gt: cutoff } },
        ],
      },
      select: { id: true },
    });
    if (recentConsent) return false;

    // Check payments
    const recentPayment = await this.prisma.payment.findFirst({
      where: {
        AND: [
          {
            OR: [
              { referralId: id },
              { subjectType: 'referral', subjectId: id },
            ],
          },
          {
            OR: [
              { updatedAt: { gt: cutoff } },
              { createdAt: { gt: cutoff } },
              { confirmedAt: { gt: cutoff } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    if (recentPayment) return false;

    return true;
  }

  private async cleanupRecordings(
    now: Date,
    dryRun: boolean,
    summary: RetentionSummary,
  ): Promise<void> {
    const cutoff = getCallRecordingRetentionCutoff(now);

    const calls = await this.prisma.callRecord.findMany({
      where: {
        recordingStoragePath: { not: null },
        recordingDeletedAt: null,
        OR: [
          { startedAt: { lte: cutoff } },
          { startedAt: null, createdAt: { lte: cutoff } },
        ],
      },
      select: {
        id: true,
        subjectType: true,
        subjectId: true,
        relatedType: true,
        relatedId: true,
        recordingStoragePath: true,
      },
    });

    for (const call of calls) {
      const isProtected = await this.isCallProtected(call);
      if (isProtected) {
        summary.recordingsProtected++;
        continue;
      }

      if (dryRun) {
        summary.recordingsDeleted++;
      } else {
        if (call.recordingStoragePath) {
          try {
            await this.recordingStorage.delete(call.recordingStoragePath);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Could not delete recording file ${call.recordingStoragePath}: ${msg}`);
          }
        }
        await this.prisma.callRecord.update({
          where: { id: call.id },
          data: { recordingDeletedAt: now },
        });
        summary.recordingsDeleted++;
      }
    }
  }

  private async isCallProtected(call: {
    id: string;
    subjectType: string | null;
    subjectId: string | null;
    relatedType: string | null;
    relatedId: string | null;
  }): Promise<boolean> {
    // 1. Open replacement claims check
    const openClaims = await this.prisma.replacementClaim.findMany({
      where: {
        OR: [
          { decision: null },
          {
            decision: 'accepted',
            placement: {
              status: { in: ['dropped_out', 'active', 'confirmed'] },
            },
          },
        ],
      },
      select: {
        id: true,
        placementId: true,
        callRecordId: true,
        exitCallRecordId: true,
        placement: {
          select: {
            jobSeekerId: true,
            businessId: true,
          },
        },
      },
    });

    for (const claim of openClaims) {
      if (claim.callRecordId === call.id || claim.exitCallRecordId === call.id) {
        return true;
      }
      if (call.relatedType === 'placement' && call.relatedId === claim.placementId) {
        return true;
      }
      if (call.relatedType === 'replacement_claim' && call.relatedId === claim.id) {
        return true;
      }
      if (
        call.subjectType === 'job_seeker' &&
        call.subjectId === claim.placement.jobSeekerId
      ) {
        return true;
      }
      if (
        call.subjectType === 'business' &&
        call.subjectId === claim.placement.businessId
      ) {
        return true;
      }
    }

    // 2. Open bypass_suspected flag check
    const openBypassFlags = await this.prisma.reviewFlag.findMany({
      where: {
        kind: 'bypass_suspected',
        status: 'open',
      },
      select: {
        id: true,
        subjectType: true,
        subjectId: true,
      },
    });

    for (const flag of openBypassFlags) {
      if (flag.subjectType === 'placement') {
        if (call.relatedType === 'placement' && call.relatedId === flag.subjectId) {
          return true;
        }
      } else if (flag.subjectType === call.subjectType && flag.subjectId === call.subjectId) {
        return true;
      }
    }

    return false;
  }

  private async cleanupAccessLogs(
    now: Date,
    dryRun: boolean,
    summary: RetentionSummary,
  ): Promise<void> {
    const cutoff = getAccessLogRetentionCutoff(now);

    const sessionCount = await this.prisma.staffSession.count({
      where: { createdAt: { lte: cutoff } },
    });
    const loginCodeCount = await this.prisma.loginCodeRequest.count({
      where: { createdAt: { lte: cutoff } },
    });

    summary.accessLogsDeleted.sessions = sessionCount;
    summary.accessLogsDeleted.loginCodeRequests = loginCodeCount;
    summary.accessLogsDeleted.total = sessionCount + loginCodeCount;

    if (!dryRun) {
      // Delete sessions first
      if (sessionCount > 0) {
        await this.prisma.staffSession.deleteMany({
          where: { createdAt: { lte: cutoff } },
        });
      }
      // Then delete login code requests
      if (loginCodeCount > 0) {
        await this.prisma.loginCodeRequest.deleteMany({
          where: { createdAt: { lte: cutoff } },
        });
      }
    }
  }

  private async cleanupMoneyRecords(
    now: Date,
    dryRun: boolean,
    summary: RetentionSummary,
  ): Promise<void> {
    const cutoff = getMoneyRecordRetentionCutoff(now);

    // BusinessAgreements older than 8 years
    const agreements = await this.prisma.businessAgreement.findMany({
      where: {
        createdAt: { lte: cutoff },
      },
      select: {
        id: true,
        documentStoragePath: true,
      },
    });
    summary.moneyRecordsDeleted.agreements = agreements.length;

    // BankCredits older than 8 years
    const bankCreditsCount = await this.prisma.bankCredit.count({
      where: {
        updatedAt: { lte: cutoff },
      },
    });
    summary.moneyRecordsDeleted.bankCredits = bankCreditsCount;

    // Payments older than 8 years
    const paymentsCount = await this.prisma.payment.count({
      where: {
        updatedAt: { lte: cutoff },
      },
    });
    summary.moneyRecordsDeleted.payments = paymentsCount;

    summary.moneyRecordsDeleted.total =
      agreements.length + bankCreditsCount + paymentsCount;

    if (!dryRun) {
      // 1. Delete agreement documents from storage and rows
      for (const ag of agreements) {
        if (ag.documentStoragePath) {
          try {
            await this.agreementStorage.delete(ag.documentStoragePath);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Could not delete agreement document ${ag.documentStoragePath}: ${msg}`);
          }
        }
      }
      if (agreements.length > 0) {
        await this.prisma.businessAgreement.deleteMany({
          where: {
            id: { in: agreements.map((a) => a.id) },
          },
        });
      }

      // 2. Delete BankCredit rows
      if (bankCreditsCount > 0) {
        await this.prisma.bankCredit.deleteMany({
          where: {
            updatedAt: { lte: cutoff },
          },
        });
      }

      // 3. Delete Payment rows
      if (paymentsCount > 0) {
        await this.prisma.payment.deleteMany({
          where: {
            updatedAt: { lte: cutoff },
          },
        });
      }
    }
  }
}
