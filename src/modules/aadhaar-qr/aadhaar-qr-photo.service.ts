import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS, CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { maskedAadhaarReference } from './secure-qr.parser';

/** The QR photo is kept until the Team Lead's check, and never longer than this (guide, 14 Nov). */
export const AADHAAR_QR_PHOTO_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type QrPhotoDeleteReason = 'team_lead_approved' | 'team_lead_rejected' | 'expired' | 'replaced' | 'erased';

export interface AadhaarCheckView {
  verificationId: string;
  method: string;
  status: string;
  verifiedByUidai: boolean;
  maskedReference: string | null;
  checkedAt: string;
  nameMatches: boolean | null;
  isAdult: boolean | null;
  phoneLinked: string | null;
  nameOnId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  area: string | null;
  pincode: string | null;
  /** Whether the QR photo is still kept; why it was deleted when not. */
  photo: { kept: boolean; deletedReason: string | null; deletedAt: string | null; expiresAt: string | null };
}

/**
 * The photo from the Aadhaar QR: private storage (the candidate-photo bucket,
 * at its own path, apart from the selfie), shown only through short-lived
 * signed links, deleted the moment the Team Lead completes the check and in
 * any case after 30 days (the daily retention job). Every deletion and every
 * view is audited.
 */
@Injectable()
export class AadhaarQrPhotoService {
  private readonly logger = new Logger(AadhaarQrPhotoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photos: CandidatePhotoStorage,
  ) {}

  static photoPath(subjectType: string, subjectId: string, verificationId: string): string {
    return `aadhaar-qr/${subjectType}/${subjectId}/${verificationId}.jpg`;
  }

  static expiryFrom(now: Date): Date {
    return new Date(now.getTime() + AADHAAR_QR_PHOTO_MAX_DAYS * DAY_MS);
  }

  /** Deletes every kept QR photo of this person; returns how many. */
  async deletePhotos(subjectType: string, subjectId: string, reason: QrPhotoDeleteReason, actorId: string, now = new Date()): Promise<number> {
    const rows = await this.prisma.aadhaarQrDetail.findMany({
      where: { subjectType, subjectId, photoPath: { not: null } },
      select: { id: true, photoPath: true, verificationId: true },
    });
    let deleted = 0;
    for (const row of rows) {
      if (await this.deleteOne(row, reason, actorId, subjectType, now)) deleted += 1;
    }
    return deleted;
  }

  /** Daily: QR photos past their 30 days (Team Lead never checked) are deleted. */
  async deleteExpiredPhotos(now = new Date(), dryRun = false): Promise<number> {
    const rows = await this.prisma.aadhaarQrDetail.findMany({
      where: { photoPath: { not: null }, photoExpiresAt: { lte: now } },
      select: { id: true, photoPath: true, verificationId: true, subjectType: true },
      take: 500,
    });
    if (dryRun) return rows.length;
    let deleted = 0;
    for (const row of rows) {
      if (await this.deleteOne(row, 'expired', 'system', row.subjectType, now)) deleted += 1;
    }
    return deleted;
  }

  private async deleteOne(
    row: { id: string; photoPath: string | null; verificationId: string },
    reason: QrPhotoDeleteReason,
    actorId: string,
    subjectType: string,
    now: Date,
  ): Promise<boolean> {
    if (!row.photoPath) return false;
    try {
      await this.photos.delete(row.photoPath);
    } catch (error) {
      // Kept for the next run; the reason is the storage's, never the photo's content.
      this.logger.warn(`Aadhaar QR photo delete failed for detail ${row.id}: ${(error as Error).message}`);
      return false;
    }
    const changed = await this.prisma.aadhaarQrDetail.updateMany({
      where: { id: row.id, photoPath: { not: null } },
      data: { photoPath: null, photoDeletedAt: now, photoDeletedReason: reason },
    });
    if (changed.count !== 1) return false;
    await this.audit.log({
      actorId,
      action: 'identity.aadhaar_qr_photo_deleted',
      entityType: subjectType === 'referral' ? 'referral_identity_verification' : 'identity_verification',
      entityCode: row.verificationId,
      before: { photoKept: true },
      after: { photoKept: false, reason },
      changedFields: ['photoKept'],
      reason: `Aadhaar QR photo deleted: ${reason.replace(/_/g, ' ')}`,
    });
    return true;
  }

  /** The latest ID check of a job seeker, for the Team Lead / Manager / CEO (callers check the scope). */
  async latestForJobSeeker(jobSeekerId: string): Promise<AadhaarCheckView | null> {
    const verification = await this.prisma.identityVerification.findFirst({
      where: { jobSeekerId },
      orderBy: { createdAt: 'desc' },
    });
    if (!verification) return null;
    const detail = await this.prisma.aadhaarQrDetail.findUnique({ where: { verificationId: verification.id } });
    return {
      verificationId: verification.id,
      method: verification.method,
      status: verification.status,
      verifiedByUidai: verification.method === 'aadhaar_qr' && verification.status === 'verified',
      maskedReference: verification.method === 'aadhaar_qr' ? maskedAadhaarReference(verification.last4) : null,
      checkedAt: (verification.verifiedAt ?? verification.createdAt).toISOString(),
      nameMatches: verification.nameMatches,
      isAdult: verification.isAdult,
      phoneLinked: verification.phoneLinked ?? null,
      nameOnId: detail?.nameOnId ?? null,
      dateOfBirth: detail?.dateOfBirth ?? null,
      gender: detail?.gender ?? null,
      area: detail?.area ?? null,
      pincode: detail?.pincode ?? null,
      photo: {
        kept: Boolean(detail?.photoPath),
        deletedReason: detail?.photoDeletedReason ?? null,
        deletedAt: detail?.photoDeletedAt?.toISOString() ?? null,
        expiresAt: detail?.photoPath ? (detail.photoExpiresAt?.toISOString() ?? null) : null,
      },
    };
  }

  /** A 5-minute signed link to the QR photo of this verification (audited), or null when it is gone. */
  async photoLink(verificationId: string, actorId: string): Promise<{ url: string; expiresInSeconds: number } | null> {
    const detail = await this.prisma.aadhaarQrDetail.findUnique({ where: { verificationId }, select: { photoPath: true, subjectType: true } });
    if (!detail?.photoPath) return null;
    const url = await this.photos.signedUrl(detail.photoPath, CANDIDATE_PHOTO_LINK_TTL_SECONDS);
    await this.audit.log({
      actorId,
      action: 'identity.aadhaar_qr_photo_viewed',
      entityType: detail.subjectType === 'referral' ? 'referral_identity_verification' : 'identity_verification',
      entityCode: verificationId,
      changedFields: [],
    });
    return { url, expiresInSeconds: CANDIDATE_PHOTO_LINK_TTL_SECONDS };
  }
}
