import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentClock } from './consent-clock';
import { REQUIRED_CONSENT_PURPOSES_BY_SUBJECT } from './consent.constants';
import { recordStatusChange } from '../../common/status-history/status-history.helper';

export interface GrantConsentDto {
  subjectType: string;
  subjectId: string;
  purpose: string;
  noticeVersion: string;
  language: string;
  method: string;
  otpRequestId?: string | null;
}

export interface WithdrawConsentDto {
  subjectType: string;
  subjectId: string;
  purpose: string;
}

@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ConsentClock,
  ) {}

  /**
   * Records or updates a consent grant for (subjectType, subjectId, purpose, noticeVersion).
   * Idempotent: repeated grant of the same purpose and notice version updates the existing row.
   * A new noticeVersion creates a new row rather than overwriting the prior version.
   */
  async grant(dto: GrantConsentDto) {
    const now = this.clock.now();

    return this.prisma.consent.upsert({
      where: {
        subjectType_subjectId_purpose_noticeVersion: {
          subjectType: dto.subjectType,
          subjectId: dto.subjectId,
          purpose: dto.purpose,
          noticeVersion: dto.noticeVersion,
        },
      },
      create: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        purpose: dto.purpose,
        noticeVersion: dto.noticeVersion,
        granted: true,
        language: dto.language,
        method: dto.method,
        otpRequestId: dto.otpRequestId ?? null,
        grantedAt: now,
        withdrawnAt: null,
      },
      update: {
        granted: true,
        language: dto.language,
        method: dto.method,
        otpRequestId: dto.otpRequestId ?? null,
        grantedAt: now,
        withdrawnAt: null,
      },
    });
  }

  /**
   * Withdraws consent for (subjectType, subjectId, purpose) by setting granted = false and withdrawnAt = now.
   * Preserves historical rows (never deletes).
   * If an active job seeker withdraws call_recording or job_matching, transitions their status to paused.
   */
  async withdraw(dto: WithdrawConsentDto) {
    const now = this.clock.now();

    const activeRows = await this.prisma.consent.findMany({
      where: {
        subjectType: dto.subjectType,
        subjectId: dto.subjectId,
        purpose: dto.purpose,
        granted: true,
        withdrawnAt: null,
      },
    });

    if (activeRows.length > 0) {
      await this.prisma.consent.updateMany({
        where: {
          id: { in: activeRows.map((r) => r.id) },
        },
        data: {
          granted: false,
          withdrawnAt: now,
        },
      });
    }

    // A withdrawal of call_recording or job_matching by an active job seeker moves status to paused
    if (
      dto.subjectType === 'job_seeker' &&
      (dto.purpose === 'call_recording' || dto.purpose === 'job_matching')
    ) {
      const seeker = await this.prisma.jobSeeker.findUnique({
        where: { id: dto.subjectId },
      });

      if (seeker && seeker.status === 'active') {
        await this.prisma.$transaction(async (tx) => {
          const updateData: Record<string, unknown> = {
            status: 'paused',
          };
          if ('pausedAt' in Prisma.JobSeekerScalarFieldEnum) {
            updateData.pausedAt = now;
          }

          await tx.jobSeeker.update({
            where: { id: seeker.id },
            data: updateData as Prisma.JobSeekerUpdateInput,
          });

          await recordStatusChange(tx, {
            subjectType: 'job_seeker',
            subjectId: seeker.id,
            fromStatus: 'active',
            toStatus: 'paused',
            reason: `Consent withdrawn for ${dto.purpose}`,
            changedAt: now,
          });
        });
      }
    }

    return { withdrawn: true };
  }

  /**
   * Returns true only when every required purpose for that subjectType has a row with
   * grantedAt set and withdrawnAt null.
   */
  async hasAllRequired(subjectType: string, subjectId: string): Promise<boolean> {
    const requiredPurposes = REQUIRED_CONSENT_PURPOSES_BY_SUBJECT[subjectType];
    if (!requiredPurposes || requiredPurposes.length === 0) {
      return false;
    }

    const activeConsents = await this.prisma.consent.findMany({
      where: {
        subjectType,
        subjectId,
        purpose: { in: [...requiredPurposes] },
        granted: true,
        grantedAt: { not: null },
        withdrawnAt: null,
      },
      select: {
        purpose: true,
      },
    });

    const activePurposeSet = new Set(activeConsents.map((c) => c.purpose));
    return requiredPurposes.every((purpose) => activePurposeSet.has(purpose));
  }

  /**
   * Returns true if active (granted = true, grantedAt != null, withdrawnAt = null) consent exists for (subjectType, subjectId, purpose).
   */
  async hasConsent(subjectType: string, subjectId: string, purpose: string): Promise<boolean> {
    const row = await this.prisma.consent.findFirst({
      where: {
        subjectType,
        subjectId,
        purpose,
        granted: true,
        grantedAt: { not: null },
        withdrawnAt: null,
      },
    });
    return Boolean(row);
  }

  /**
   * Returns all consent records for a given subject.
   */
  async getConsents(subjectType: string, subjectId: string) {
    return this.prisma.consent.findMany({
      where: { subjectType, subjectId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
