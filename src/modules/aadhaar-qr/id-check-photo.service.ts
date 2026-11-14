import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS, CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { maskedAadhaarReference } from './secure-qr.parser';

/** An ID photo is kept until the Team Lead's decision, and never longer than this (guide, 14 Nov). */
export const ID_PHOTO_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type IdPhotoKind = 'aadhaar_qr' | 'id_card_photo';
export type IdPhotoDeleteReason = 'team_lead_approved' | 'team_lead_rejected' | 'expired' | 'replaced' | 'erased';

/** A row with method aadhaar_qr counts as "verified by UIDAI" only when it came from the signed-QR check. */
export function verifiedByUidai(row: { method: string; vendor: string | null }): boolean {
  return row.method === 'aadhaar_qr' && row.vendor === 'uidai_secure_qr';
}

export interface IdCheckView {
  verificationId: string;
  method: string;
  status: string;
  /** UIDAI's digital signature passed (signed Aadhaar QR). */
  verifiedByUidai: boolean;
  maskedReference: string | null;
  /** Another ID: the last 4 digits of the number he typed. */
  idNumberLast4: string | null;
  checkedAt: string;
  nameMatches: boolean | null;
  isAdult: boolean | null;
  phoneLinked: string | null;
  /** A signed Aadhaar QR showed under 18 and no Manager / CEO has lifted the stop. */
  under18Stop: boolean;
  nameOnId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  area: string | null;
  pincode: string | null;
  /** The QR photo or the photo of the ID card: still kept, or why it was deleted. */
  photo: { kind: IdPhotoKind | null; kept: boolean; deletedReason: string | null; deletedAt: string | null; expiresAt: string | null };
}

/**
 * ID photos — the photo from the Aadhaar QR and the live photo of another ID
 * card: private storage (the candidate-photo bucket, at their own paths,
 * apart from the selfie), shown only through short-lived signed links,
 * deleted the moment the Team Lead decides and in any case after 30 days (the
 * daily retention run). A delete that fails is retried by that run. Every
 * deletion and every view is audited.
 */
@Injectable()
export class IdCheckPhotoService {
  private readonly logger = new Logger(IdCheckPhotoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photos: CandidatePhotoStorage,
  ) {}

  static photoPath(kind: IdPhotoKind, subjectType: string, subjectId: string, verificationId: string): string {
    return `${kind === 'aadhaar_qr' ? 'aadhaar-qr' : 'id-card'}/${subjectType}/${subjectId}/${verificationId}.jpg`;
  }

  static expiryFrom(now: Date): Date {
    return new Date(now.getTime() + ID_PHOTO_MAX_DAYS * DAY_MS);
  }

  /**
   * Stores a photo for a detail row that is already committed (so a failed
   * database write never leaves an orphan photo). Returns whether it was stored.
   */
  async attachPhoto(detailId: string, path: string, body: Buffer, contentType: string, now: Date): Promise<boolean> {
    try {
      await this.photos.put(path, body, contentType);
    } catch (error) {
      this.logger.warn(`ID photo could not be stored for detail ${detailId}: ${(error as Error).message}`);
      return false;
    }
    try {
      await this.prisma.idCheckDetail.update({ where: { id: detailId }, data: { photoPath: path, photoExpiresAt: IdCheckPhotoService.expiryFrom(now) } });
      return true;
    } catch (error) {
      await this.photos.delete(path).catch(() => undefined);
      throw error;
    }
  }

  /** Deletes every kept ID photo of this person; returns how many. A failed delete is retried by the daily run. */
  async deletePhotos(subjectType: string, subjectId: string, reason: IdPhotoDeleteReason, actorId: string, now = new Date(), exceptVerificationId?: string): Promise<number> {
    const rows = await this.prisma.idCheckDetail.findMany({
      where: { subjectType, subjectId, photoPath: { not: null } },
      select: { id: true, photoPath: true, verificationId: true },
    });
    let deleted = 0;
    for (const row of rows) {
      if (row.verificationId === exceptVerificationId) continue;
      if (await this.deleteOne(row, reason, actorId, subjectType, now)) deleted += 1;
    }
    return deleted;
  }

  /** Daily: ID photos past their 30 days (or whose earlier delete failed), oldest first. */
  async deleteExpiredPhotos(now = new Date(), dryRun = false): Promise<number> {
    const rows = await this.prisma.idCheckDetail.findMany({
      where: { photoPath: { not: null }, photoExpiresAt: { lte: now } },
      select: { id: true, photoPath: true, verificationId: true, subjectType: true },
      orderBy: { photoExpiresAt: 'asc' },
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
    reason: IdPhotoDeleteReason,
    actorId: string,
    subjectType: string,
    now: Date,
  ): Promise<boolean> {
    if (!row.photoPath) return false;
    try {
      await this.photos.delete(row.photoPath);
    } catch (error) {
      // Kept for the daily run, which picks it up at once (expiry = now).
      this.logger.warn(`ID photo delete failed for detail ${row.id}: ${(error as Error).message}`);
      await this.prisma.idCheckDetail.updateMany({ where: { id: row.id, photoPath: { not: null } }, data: { photoExpiresAt: now } });
      return false;
    }
    const changed = await this.prisma.idCheckDetail.updateMany({
      where: { id: row.id, photoPath: { not: null } },
      data: { photoPath: null, photoDeletedAt: now, photoDeletedReason: reason },
    });
    if (changed.count !== 1) return false;
    await this.audit.log({
      actorId,
      action: 'identity.id_photo_deleted',
      entityType: subjectType === 'referral' ? 'referral_identity_verification' : 'identity_verification',
      entityCode: row.verificationId,
      before: { photoKept: true },
      after: { photoKept: false, reason },
      changedFields: ['photoKept'],
      reason: `ID photo deleted: ${reason.replace(/_/g, ' ')}`,
    });
    return true;
  }

  /** The latest ID check of a job seeker or referral partner, for the Team Lead / Manager / CEO (callers check the scope and audit the view). */
  async latestFor(subjectType: 'job_seeker' | 'referral', subjectId: string): Promise<IdCheckView | null> {
    const stopWhere = { method: 'aadhaar_qr', vendor: 'uidai_secure_qr', isAdult: false, under18LiftedAt: null };
    const [verification, stop] =
      subjectType === 'job_seeker'
        ? await Promise.all([
          this.prisma.identityVerification.findFirst({ where: { jobSeekerId: subjectId }, orderBy: { createdAt: 'desc' } }),
          this.prisma.identityVerification.findFirst({ where: { jobSeekerId: subjectId, ...stopWhere }, select: { id: true } }),
        ])
        : await Promise.all([
          this.prisma.referralIdentityVerification.findFirst({ where: { referralId: subjectId }, orderBy: { createdAt: 'desc' } }),
          this.prisma.referralIdentityVerification.findFirst({ where: { referralId: subjectId, ...stopWhere }, select: { id: true } }),
        ]);
    if (!verification) return null;
    const detail = await this.prisma.idCheckDetail.findUnique({ where: { verificationId: verification.id } });
    const uidai = verifiedByUidai(verification);
    return {
      verificationId: verification.id,
      method: verification.method,
      status: verification.status,
      verifiedByUidai: uidai,
      maskedReference: uidai ? maskedAadhaarReference(verification.last4) : null,
      idNumberLast4: verification.method !== 'aadhaar_qr' ? verification.last4 : null,
      checkedAt: (verification.verifiedAt ?? verification.createdAt).toISOString(),
      nameMatches: verification.nameMatches,
      isAdult: verification.isAdult,
      phoneLinked: verification.phoneLinked ?? null,
      under18Stop: Boolean(stop),
      nameOnId: detail?.nameOnId ?? null,
      dateOfBirth: detail?.dateOfBirth ?? null,
      gender: detail?.gender ?? null,
      area: detail?.area ?? null,
      pincode: detail?.pincode ?? null,
      photo: {
        kind: (detail?.kind as IdPhotoKind | undefined) ?? null,
        kept: Boolean(detail?.photoPath),
        deletedReason: detail?.photoDeletedReason ?? null,
        deletedAt: detail?.photoDeletedAt?.toISOString() ?? null,
        expiresAt: detail?.photoPath ? (detail.photoExpiresAt?.toISOString() ?? null) : null,
      },
    };
  }

  latestForJobSeeker(jobSeekerId: string): Promise<IdCheckView | null> {
    return this.latestFor('job_seeker', jobSeekerId);
  }

  /** A 5-minute signed link to the ID photo of this verification, or null when it is gone. */
  async photoLink(verificationId: string): Promise<{ url: string; expiresInSeconds: number } | null> {
    const detail = await this.prisma.idCheckDetail.findUnique({ where: { verificationId }, select: { photoPath: true } });
    if (!detail?.photoPath) return null;
    const url = await this.photos.signedUrl(detail.photoPath, CANDIDATE_PHOTO_LINK_TTL_SECONDS);
    return { url, expiresInSeconds: CANDIDATE_PHOTO_LINK_TTL_SECONDS };
  }
}
