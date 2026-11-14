import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { detectSelfieImageType } from '../../common/image-type';
import { assertNoRawAadhaar } from '../job-seeker/job-seeker.validator';
import { IdCheckPhotoService } from './id-check-photo.service';
import { AADHAAR_ONLY_BY_QR, isOtherIdMethod, OTHER_ID_METHODS, OtherIdMethod } from './id-methods';
import { Under18StopService } from './under18-stop.service';

/** What a typed number must look like (spaces ignored, capitals). */
export const OTHER_ID_PATTERNS: Record<OtherIdMethod, RegExp> = {
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  driving_licence: /^[A-Z0-9-]{8,20}$/,
  voter_id: /^[A-Z]{3}\d{7}$/,
};

export interface OtherIdInput {
  idType: unknown;
  idNumber: unknown;
  captureSource: unknown;
  photo: { buffer: Buffer } | undefined;
}

export interface OtherIdOutcome {
  verificationId: string;
  method: OtherIdMethod;
  /** Always pending: the Team Lead decides by eye. */
  status: 'pending';
  idNumberLast4: string;
}

/**
 * Another government ID (guide, rev 154): PAN, driving licence or voter ID,
 * always offered. No outside company, ₹0: the person takes a live camera
 * photo of the card (no gallery, no file upload) and types its number; the
 * Team Lead sees the card next to the live selfie in T-Verify and approves
 * ("Looks right") or rejects ("Fake · flag it"). Until then the check is
 * pending and registration doesn't go past the ID step.
 *
 * Kept: the ID type and the last 4 digits of the number (never the full
 * number), the time, the consent record, and the card photo — private, until
 * the Team Lead's decision, 30 days at most.
 */
@Injectable()
export class OtherIdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idPhotos: IdCheckPhotoService,
    private readonly stops: Under18StopService,
  ) {}

  async submitForJobSeeker(jobSeekerId: string, input: OtherIdInput, context: { channel: 'link' | 'field'; staffId?: string | null; now?: Date }): Promise<OtherIdOutcome> {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
      select: { id: true, code: true, city: true, photoStoragePath: true, anonymisedAt: true },
    });
    if (!seeker || seeker.anonymisedAt) throw new NotFoundException('Job seeker not found');
    const consent = await this.prisma.consent.findFirst({
      where: { subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'aadhaar_verification', granted: true, grantedAt: { not: null }, withdrawnAt: null },
      orderBy: { grantedAt: 'desc' },
      select: { id: true },
    });
    if (!consent) throw new BadRequestException('Consent for aadhaar_verification is required before the ID check');
    if (!seeker.photoStoragePath) throw new BadRequestException('Take the selfie first');
    return this.submit({ type: 'job_seeker', id: seeker.id, code: seeker.code, city: seeker.city }, consent.id, input, context);
  }

  async submitForReferral(referralId: string, input: OtherIdInput, context: { channel: 'link'; now?: Date }): Promise<OtherIdOutcome> {
    const referral = await this.prisma.referral.findUnique({ where: { id: referralId }, select: { id: true, code: true, city: true, photoStoragePath: true, anonymisedAt: true } });
    if (!referral || referral.anonymisedAt) throw new NotFoundException('Referral partner not found');
    const consent = await this.prisma.consent.findFirst({
      where: { subjectType: 'referral', subjectId: referral.id, purpose: 'agreement_terms', granted: true, grantedAt: { not: null }, withdrawnAt: null },
      orderBy: { grantedAt: 'desc' },
      select: { id: true },
    });
    if (!consent) throw new BadRequestException('Referral terms and call-recording consent are required before ID verification');
    if (!referral.photoStoragePath) throw new BadRequestException('Complete the live-camera selfie before the ID check');
    return this.submit({ type: 'referral', id: referral.id, code: referral.code, city: referral.city }, consent.id, input, context);
  }

  private async submit(
    subject: { type: 'job_seeker' | 'referral'; id: string; code: string; city: string },
    consentId: string,
    input: OtherIdInput,
    context: { channel: 'link' | 'field'; staffId?: string | null; now?: Date },
  ): Promise<OtherIdOutcome> {
    assertNoRawAadhaar({ idNumber: input.idNumber });
    if (input.idType === 'aadhaar_qr' || input.idType === 'aadhaar') throw new BadRequestException(AADHAAR_ONLY_BY_QR);
    if (!isOtherIdMethod(input.idType)) throw new BadRequestException(`Choose the ID: ${OTHER_ID_METHODS.join(', ')}`);
    const method = input.idType;
    const number = typeof input.idNumber === 'string' ? input.idNumber.toUpperCase().replace(/\s+/g, '') : '';
    if (!OTHER_ID_PATTERNS[method].test(number)) throw new BadRequestException('Type the number exactly as it is on the card');
    if (input.captureSource !== 'live_camera') throw new BadRequestException('Take the photo of the card with the live camera; gallery or file uploads are refused');
    if (!input.photo?.buffer.length) throw new BadRequestException('A live camera photo of the card is required');
    const contentType = detectSelfieImageType(input.photo.buffer);
    if (!contentType) throw new BadRequestException('The photo of the card must be a JPEG, PNG or WebP image');
    await this.stops.assertNotStopped(subject.type, subject.id);

    const now = context.now ?? new Date();
    const verificationId = randomUUID();
    const detailId = randomUUID();
    const last4 = number.replace(/[^A-Z0-9]/g, '').slice(-4);
    const row = { id: verificationId, method, vendor: 'team_lead_check', vendorReference: null, status: 'pending', last4, consentId, nameMatches: null, isAdult: null, verifiedAt: null, failureReason: null };
    await this.prisma.$transaction(async (tx) => {
      if (subject.type === 'job_seeker') await tx.identityVerification.create({ data: { ...row, jobSeekerId: subject.id } });
      else await tx.referralIdentityVerification.create({ data: { ...row, referralId: subject.id } });
      await tx.idCheckDetail.create({ data: { id: detailId, subjectType: subject.type, subjectId: subject.id, verificationId, kind: 'id_card_photo' } });
    });
    const stored = await this.idPhotos.attachPhoto(detailId, IdCheckPhotoService.photoPath('id_card_photo', subject.type, subject.id, verificationId), input.photo.buffer, contentType, now);
    if (!stored) throw new BadRequestException('The photo could not be saved. Try again.');
    await this.idPhotos.deletePhotos(subject.type, subject.id, 'replaced', context.staffId ?? 'system', now, verificationId);
    await this.audit.log({
      actorId: context.staffId ?? 'system',
      action: 'identity.other_id_submitted',
      entityType: subject.type,
      entityCode: subject.code,
      after: { verificationId, method, status: 'pending', idNumberLast4: last4, channel: context.channel },
      changedFields: ['method', 'status'],
      reason: context.channel === 'field' ? 'ID card photographed live in Laboura Field' : 'ID card photographed live through the registration link',
      city: subject.city,
    });
    return { verificationId, method, status: 'pending', idNumberLast4: last4 };
  }

  /**
   * The Team Lead's decision in T-Verify: "Looks right" approves a pending
   * other-ID check (verified, name and 18+ confirmed by eye), "Fake · flag it"
   * rejects it. Either way every ID photo of the person is deleted (audited).
   */
  async recordTeamLeadDecision(subjectType: 'job_seeker' | 'referral', subjectId: string, verdict: 'ok' | 'fake', actorId: string, now = new Date()) {
    const pending =
      subjectType === 'job_seeker'
        ? await this.prisma.identityVerification.findFirst({ where: { jobSeekerId: subjectId, status: 'pending', vendor: 'team_lead_check' }, orderBy: { createdAt: 'desc' }, select: { id: true, method: true, last4: true } })
        : await this.prisma.referralIdentityVerification.findFirst({ where: { referralId: subjectId, status: 'pending', vendor: 'team_lead_check' }, orderBy: { createdAt: 'desc' }, select: { id: true, method: true, last4: true } });
    let otherIdDecided: 'verified' | 'failed' | null = null;
    if (pending && !(verdict === 'ok' && (await this.stops.isStopped(subjectType, subjectId)))) {
      const data = verdict === 'ok'
        ? { status: 'verified', nameMatches: true, isAdult: true, verifiedAt: now, failureReason: null }
        : { status: 'failed', nameMatches: null, isAdult: null, verifiedAt: null, failureReason: 'Rejected by the Team Lead' };
      if (subjectType === 'job_seeker') await this.prisma.identityVerification.update({ where: { id: pending.id }, data });
      else await this.prisma.referralIdentityVerification.update({ where: { id: pending.id }, data });
      otherIdDecided = verdict === 'ok' ? 'verified' : 'failed';
      await this.audit.log({
        actorId,
        action: verdict === 'ok' ? 'identity.other_id_approved' : 'identity.other_id_rejected',
        entityType: subjectType === 'referral' ? 'referral_identity_verification' : 'identity_verification',
        entityCode: pending.id,
        before: { status: 'pending' },
        after: { status: otherIdDecided, method: pending.method, idNumberLast4: pending.last4 },
        changedFields: ['status'],
      });
    }
    const photosDeleted = await this.idPhotos.deletePhotos(subjectType, subjectId, verdict === 'ok' ? 'team_lead_approved' : 'team_lead_rejected', actorId, now);
    return { otherIdDecided, photosDeleted };
  }
}
