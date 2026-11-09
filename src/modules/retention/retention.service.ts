import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
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
} from './retention.policy';

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
    };

    // 1. Profiles (> 23 months inactive)
    await this.cleanupProfiles(now, dryRun, summary);

    // 2. Call recordings (> 12 months)
    await this.cleanupRecordings(now, dryRun, summary);

    // 3. Login and access logs (> 12 months)
    await this.cleanupAccessLogs(now, dryRun, summary);

    // 4. Money records (> 8 years)
    await this.cleanupMoneyRecords(now, dryRun, summary);

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
            summary.moneyRecordsDeleted.total,
          hitsRecorded: 0,
          details: {
            executedAt: summary.executedAt.toISOString(),
            dryRun: summary.dryRun,
            profilesAnonymised: summary.profilesAnonymised,
            recordingsDeleted: summary.recordingsDeleted,
            recordingsProtected: summary.recordingsProtected,
            accessLogsDeleted: summary.accessLogsDeleted,
            moneyRecordsDeleted: summary.moneyRecordsDeleted,
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
    };
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
        erasedAt: null,
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
        erasedAt: null,
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
