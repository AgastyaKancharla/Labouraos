import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CANDIDATE_PHOTO_STORAGE,
  CandidatePhotoStorage,
} from '../../modules/job-seeker/photo-storage';

export type AnonymisableSubjectType = 'job_seeker' | 'business' | 'referral';

export interface AnonymiseResult {
  message: string;
  id: string;
  code: string;
  anonymisedAt: Date;
}

@Injectable()
export class AnonymisationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(CANDIDATE_PHOTO_STORAGE)
    private readonly photoStorage: CandidatePhotoStorage,
  ) {}

  async canAnonymise(
    subjectType: AnonymisableSubjectType,
    subjectId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      await this.assertNoOpenDisputesOrMoney(subjectType, subjectId);
      return { allowed: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { allowed: false, reason: message };
    }
  }

  async anonymise(
    subjectType: AnonymisableSubjectType,
    subjectId: string,
    reason: string = 'DPDP erasure request',
    actorId?: string,
  ): Promise<AnonymiseResult> {
    const record = await this.loadRecord(subjectType, subjectId);
    const code = record.code as string;
    const id = record.id as string;
    const city = (record.city as string) ?? 'Bengaluru';

    // Idempotent: safe no-op if already anonymised
    if (record.anonymisedAt) {
      return {
        message: `${subjectType} already anonymised`,
        id,
        code,
        anonymisedAt: record.anonymisedAt as Date,
      };
    }

    // Refusal checks
    await this.assertNoOpenDisputesOrMoney(subjectType, id);

    const now = new Date();
    const changedFields: string[] = ['name', 'phone', 'erasedAt', 'anonymisedAt'];

    switch (subjectType) {
      case 'job_seeker': {
        const photoPath = record.photoStoragePath as string | null;
        if (photoPath) {
          try {
            await this.photoStorage.delete(photoPath);
          } catch {
            // ignore if already deleted
          }
        }

        const cvPath = record.cvStoragePath as string | null;
        if (cvPath) {
          try {
            await this.photoStorage.delete(cvPath);
          } catch {
            // ignore if already deleted
          }
        }

        const placeholderPhone = `+91000${code.replace(/\D/g, '').padStart(7, '0')}`;

        await this.prisma.jobSeeker.update({
          where: { id },
          data: {
            name: 'Anonymised',
            phone: placeholderPhone,
            whatsappPhone: null,
            dateOfBirth: null,
            gender: null,
            photoStoragePath: null,
            photoTakenAt: null,
            cvStoragePath: null,
            latitude: null,
            longitude: null,
            lastEmployer: null,
            lastRole: null,
            lastSalaryPaise: null,
            erasedAt: now,
            anonymisedAt: now,
          },
        });

        changedFields.push(
          'whatsappPhone',
          'dateOfBirth',
          'gender',
          'photoStoragePath',
          'photoTakenAt',
          'cvStoragePath',
          'latitude',
          'longitude',
          'lastEmployer',
          'lastRole',
          'lastSalaryPaise',
        );
        break;
      }

      case 'business': {
        const placeholderPhone = `+91000${code.replace(/\D/g, '').padStart(7, '0')}`;

        await this.prisma.business.update({
          where: { id },
          data: {
            phone: placeholderPhone,
            ownerName: null,
            additionalContactName: null,
            additionalContactPhone: null,
            contactName: null,
            billingName: null,
            billingAddress: null,
            address: null,
            gstNumber: null,
            pan: null,
            selfieUrl: null,
            selfieHash: null,
            erasedAt: now,
            anonymisedAt: now,
          },
        });

        changedFields.push(
          'ownerName',
          'additionalContactName',
          'additionalContactPhone',
          'contactName',
          'billingName',
          'billingAddress',
          'address',
          'gstNumber',
          'pan',
        );
        break;
      }

      case 'referral': {
        const placeholderPhone = `+91000${code.replace(/\D/g, '').padStart(7, '0')}`;

        await this.prisma.referral.update({
          where: { id },
          data: {
            name: 'Anonymised',
            phone: placeholderPhone,
            anonymisedAt: now,
          },
        });
        break;
      }
    }

    // Wipe payout accounts
    await this.prisma.payoutAccount.updateMany({
      where: { ownerType: subjectType, ownerId: id },
      data: {
        upiIdEncrypted: null,
        bankAccountEncrypted: null,
        verifiedName: null,
        ownerNameAtEntry: 'Anonymised',
      },
    });

    // Write one audit entry with no personal values
    await this.auditService.log({
      action: 'dpdp.erasure_requested',
      entityType: subjectType,
      entityCode: code,
      actorId: actorId ?? 'system',
      city,
      reason,
      changedFields,
      before: {
        anonymisedAt: null,
      },
      after: {
        anonymisedAt: now,
      },
    });

    return {
      message: `${subjectType} anonymised successfully`,
      id,
      code,
      anonymisedAt: now,
    };
  }

  private async loadRecord(
    subjectType: AnonymisableSubjectType,
    subjectId: string,
  ): Promise<Record<string, unknown>> {
    let record: Record<string, unknown> | null = null;
    switch (subjectType) {
      case 'job_seeker':
        record = (await this.prisma.jobSeeker.findUnique({
          where: { id: subjectId },
        })) as Record<string, unknown> | null;
        if (!record) {
          record = (await this.prisma.jobSeeker.findUnique({
            where: { code: subjectId },
          })) as Record<string, unknown> | null;
        }
        break;
      case 'business':
        record = (await this.prisma.business.findUnique({
          where: { id: subjectId },
        })) as Record<string, unknown> | null;
        if (!record) {
          record = (await this.prisma.business.findUnique({
            where: { code: subjectId },
          })) as Record<string, unknown> | null;
        }
        break;
      case 'referral':
        record = (await this.prisma.referral.findUnique({
          where: { id: subjectId },
        })) as Record<string, unknown> | null;
        if (!record) {
          record = (await this.prisma.referral.findUnique({
            where: { code: subjectId },
          })) as Record<string, unknown> | null;
        }
        break;
    }

    if (!record) {
      throw new NotFoundException(`${subjectType} '${subjectId}' not found`);
    }
    return record;
  }

  private async assertNoOpenDisputesOrMoney(
    subjectType: AnonymisableSubjectType,
    id: string,
  ): Promise<void> {
    // 1. Open replacement claim check
    if (subjectType === 'job_seeker') {
      const openClaim = await this.prisma.replacementClaim.findFirst({
        where: {
          placement: { jobSeekerId: id },
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
      });
      if (openClaim) {
        throw new BadRequestException(
          'Cannot anonymise: subject has an open replacement claim',
        );
      }
      const droppedOutPlacement = await this.prisma.placement.findFirst({
        where: {
          jobSeekerId: id,
          status: 'dropped_out',
        },
      });
      if (droppedOutPlacement) {
        throw new BadRequestException(
          'Cannot anonymise: subject has an open replacement claim',
        );
      }
    } else if (subjectType === 'business') {
      const openClaim = await this.prisma.replacementClaim.findFirst({
        where: {
          placement: { businessId: id },
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
      });
      if (openClaim) {
        throw new BadRequestException(
          'Cannot anonymise: subject has an open replacement claim',
        );
      }
      const droppedOutPlacement = await this.prisma.placement.findFirst({
        where: {
          businessId: id,
          status: 'dropped_out',
        },
      });
      if (droppedOutPlacement) {
        throw new BadRequestException(
          'Cannot anonymise: subject has an open replacement claim',
        );
      }
    }

    // 2. Open bypass_suspected flag check
    const placementIds: string[] = [];
    if (subjectType === 'business') {
      const pl = await this.prisma.placement.findMany({
        where: { businessId: id },
        select: { id: true },
      });
      placementIds.push(...pl.map((p) => p.id));
    } else if (subjectType === 'job_seeker') {
      const pl = await this.prisma.placement.findMany({
        where: { jobSeekerId: id },
        select: { id: true },
      });
      placementIds.push(...pl.map((p) => p.id));
    }

    const openFlag = await this.prisma.reviewFlag.findFirst({
      where: {
        kind: 'bypass_suspected',
        status: 'open',
        OR: [
          { subjectType, subjectId: id },
          ...(placementIds.length
            ? [
                {
                  subjectType: 'placement',
                  subjectId: { in: placementIds },
                },
              ]
            : []),
        ],
      },
    });
    if (openFlag) {
      throw new BadRequestException(
        'Cannot anonymise: subject has an open bypass_suspected flag',
      );
    }

    // 3. Money owed to or by them that is not yet paid (pending or approved)
    const pendingPayment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          { jobSeekerId: id },
          { businessId: id },
          { referralId: id },
        ],
        status: { in: ['pending', 'approved'] },
      },
    });
    if (pendingPayment) {
      throw new BadRequestException(
        'Cannot anonymise: subject has unpaid money pending or approved',
      );
    }
  }
}
