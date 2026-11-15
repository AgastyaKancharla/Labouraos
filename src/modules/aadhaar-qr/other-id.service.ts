import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { assertNoRawAadhaar } from '../job-seeker/job-seeker.validator';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { ID_PHOTO_EXPIRED_REASON, IdCheckPhotoService } from './id-check-photo.service';
import { CARD_PHOTO_MESSAGES, checkCardPhoto } from './id-card-image';
import { AADHAAR_ONLY_BY_QR, isOtherIdMethod, OTHER_ID_METHODS, OtherIdMethod } from './id-methods';
import { OtherIdApprovalService, OtherIdSubjectType } from './other-id-approval.service';
import { UNDER_18_STOP_MESSAGE, Under18StopService } from './under18-stop.service';

/** What a typed number must look like (spaces ignored, capitals). */
export const OTHER_ID_PATTERNS: Record<OtherIdMethod, RegExp> = {
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  driving_licence: /^[A-Z0-9-]{8,20}$/,
  voter_id: /^[A-Z]{3}\d{7}$/,
};

/** The "camera opened" token lives this long and works once. */
export const CAPTURE_NONCE_TTL_SECONDS = 120;
export const CAPTURE_NONCE_MESSAGE = 'The camera was open too long, or this photo was already sent. Take the photo of the card again.';
export const ID_REPLACED_REASON = 'Replaced by a newer photo of the card';
export const PHOTO_NOT_SAVED_REASON = 'The photo of the card could not be saved';
export const PHOTO_GONE_MESSAGE = 'The photo of the card is no longer kept (it expired or was deleted), so it cannot be approved. The check is closed and the person is asked for a new photo.';
export const OPEN_PHOTO_FIRST_MESSAGE = 'Open the photos first: compare the card with the live selfie before approving it.';
export const ALREADY_DECIDED_MESSAGE = 'Someone has just decided this ID. Reload the page.';

export interface OtherIdInput {
  idType: unknown;
  idNumber: unknown;
  captureSource: unknown;
  /** The one-time token the page got when the camera opened (POST …/other-id/capture-nonce). */
  captureNonce: unknown;
  photo: { buffer: Buffer } | undefined;
}

export interface OtherIdOutcome {
  verificationId: string;
  method: OtherIdMethod;
  /** Always pending: a Team Lead (or, where there is none, a Manager or the CEO) decides by eye. */
  status: 'pending';
  idNumberLast4: string;
}

interface Context {
  channel: 'link' | 'field';
  staffId?: string | null;
  now?: Date;
}

interface SubjectRow {
  type: OtherIdSubjectType;
  id: string;
  code: string;
  city: string;
  registeredByStaffId: string | null;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Another government ID (guide, rev 154 / rev 169): PAN, driving licence or
 * voter ID, always offered. No outside company, ₹0: the person takes a live
 * camera photo of the card (no gallery, no file upload) and types its number;
 * a Team Lead sees the card next to the live selfie in T-Verify and approves
 * ("Looks right") or rejects ("Fake · flag it"). Who that is follows rev 169
 * (OtherIdApprovalService): never the person who registered them. Until then
 * the check is pending and registration doesn't go past the ID step.
 *
 * The live-camera rule is raised by a one-time capture token and by refusing
 * pictures that carry camera / editing metadata or a size the capture canvas
 * can't make (id-card-image.ts); the stored photo is re-encoded without any
 * metadata. None of that proves a photo is live: the Team Lead's eye is the
 * real control.
 *
 * Kept: the ID type and the last 4 digits of the number (never the full
 * number), the time, the consent record, and the card photo — private, until
 * the decision, 30 days at most (then the check closes as failed and a new
 * photo is asked for).
 */
@Injectable()
export class OtherIdService {
  private readonly logger = new Logger(OtherIdService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly idPhotos: IdCheckPhotoService,
    private readonly stops: Under18StopService,
    private readonly approvals: OtherIdApprovalService,
    @Optional() private readonly flags?: ReviewFlagService,
  ) {}

  /** A one-time token for the camera that just opened (2 minutes, one upload, this person — and this field agent in Laboura Field). */
  async issueCaptureNonce(subjectType: OtherIdSubjectType, subjectId: string, context: { staffId?: string | null; now?: Date } = {}) {
    const now = context.now ?? new Date();
    const subject = await this.subject(subjectType, subjectId);
    await this.stops.assertNotStopped(subject.type, subject.id);
    const captureNonce = randomBytes(24).toString('base64url');
    await this.prisma.idCaptureNonce.deleteMany({ where: { expiresAt: { lt: now } } });
    await this.prisma.idCaptureNonce.create({
      data: { subjectType, subjectId, staffId: context.staffId ?? null, nonceHash: sha256(captureNonce), expiresAt: new Date(now.getTime() + CAPTURE_NONCE_TTL_SECONDS * 1000) },
    });
    return { captureNonce, expiresInSeconds: CAPTURE_NONCE_TTL_SECONDS };
  }

  async submitForJobSeeker(jobSeekerId: string, input: OtherIdInput, context: Context): Promise<OtherIdOutcome> {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
      select: { id: true, code: true, city: true, photoStoragePath: true, anonymisedAt: true, registeredByStaffId: true },
    });
    if (!seeker || seeker.anonymisedAt) throw new NotFoundException('Job seeker not found');
    const consent = await this.prisma.consent.findFirst({
      where: { subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'aadhaar_verification', granted: true, grantedAt: { not: null }, withdrawnAt: null },
      orderBy: { grantedAt: 'desc' },
      select: { id: true },
    });
    if (!consent) throw new BadRequestException('Consent for aadhaar_verification is required before the ID check');
    if (!seeker.photoStoragePath) throw new BadRequestException('Take the selfie first');
    return this.submit({ type: 'job_seeker', id: seeker.id, code: seeker.code, city: seeker.city, registeredByStaffId: seeker.registeredByStaffId }, consent.id, input, context);
  }

  async submitForReferral(referralId: string, input: OtherIdInput, context: { channel: 'link'; now?: Date }): Promise<OtherIdOutcome> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: { id: true, code: true, city: true, photoStoragePath: true, anonymisedAt: true, registeredByStaffId: true },
    });
    if (!referral || referral.anonymisedAt) throw new NotFoundException('Referral partner not found');
    const consent = await this.prisma.consent.findFirst({
      where: { subjectType: 'referral', subjectId: referral.id, purpose: 'agreement_terms', granted: true, grantedAt: { not: null }, withdrawnAt: null },
      orderBy: { grantedAt: 'desc' },
      select: { id: true },
    });
    if (!consent) throw new BadRequestException('Referral terms and call-recording consent are required before ID verification');
    if (!referral.photoStoragePath) throw new BadRequestException('Complete the live-camera selfie before the ID check');
    return this.submit({ type: 'referral', id: referral.id, code: referral.code, city: referral.city, registeredByStaffId: referral.registeredByStaffId }, consent.id, input, context);
  }

  private async subject(subjectType: OtherIdSubjectType, subjectId: string): Promise<SubjectRow> {
    const select = { id: true, code: true, city: true, registeredByStaffId: true, anonymisedAt: true } as const;
    const row =
      subjectType === 'job_seeker'
        ? await this.prisma.jobSeeker.findUnique({ where: { id: subjectId }, select })
        : await this.prisma.referral.findUnique({ where: { id: subjectId }, select });
    if (!row || row.anonymisedAt) throw new NotFoundException('Not found');
    return { type: subjectType, id: row.id, code: row.code, city: row.city, registeredByStaffId: row.registeredByStaffId };
  }

  private async consumeNonce(subject: SubjectRow, staffId: string | null, nonce: unknown, now: Date): Promise<boolean> {
    if (typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 100) return false;
    const used = await this.prisma.idCaptureNonce.updateMany({
      where: { nonceHash: sha256(nonce), subjectType: subject.type, subjectId: subject.id, staffId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return used.count === 1;
  }

  private async submit(subject: SubjectRow, consentId: string, input: OtherIdInput, context: Context): Promise<OtherIdOutcome> {
    assertNoRawAadhaar({ idNumber: input.idNumber });
    if (input.idType === 'aadhaar_qr' || input.idType === 'aadhaar') throw new BadRequestException(AADHAAR_ONLY_BY_QR);
    if (!isOtherIdMethod(input.idType)) throw new BadRequestException(`Choose the ID: ${OTHER_ID_METHODS.join(', ')}`);
    const method = input.idType;
    const number = typeof input.idNumber === 'string' ? input.idNumber.toUpperCase().replace(/\s+/g, '') : '';
    if (!OTHER_ID_PATTERNS[method].test(number)) throw new BadRequestException('Type the number exactly as it is on the card');
    if (input.captureSource !== 'live_camera') throw new BadRequestException('Take the photo of the card with the live camera; gallery or file uploads are refused');
    if (!input.photo?.buffer.length) throw new BadRequestException('A live camera photo of the card is required');
    await this.stops.assertNotStopped(subject.type, subject.id);
    const now = context.now ?? new Date();
    if (!(await this.consumeNonce(subject, context.channel === 'field' ? (context.staffId ?? null) : null, input.captureNonce, now))) {
      throw new BadRequestException(CAPTURE_NONCE_MESSAGE);
    }
    const photo = checkCardPhoto(input.photo.buffer);
    if (!photo.ok) throw new BadRequestException(CARD_PHOTO_MESSAGES[photo.reason]);

    const verificationId = randomUUID();
    const detailId = randomUUID();
    const last4 = number.replace(/[^A-Z0-9]/g, '').slice(-4);
    const row = { id: verificationId, method, vendor: 'team_lead_check', vendorReference: null, status: 'pending', last4, consentId, nameMatches: null, isAdult: null, verifiedAt: null, failureReason: null };
    // One submission at a time per person; a newer photo closes any older pending one.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`other-id:${subject.type}:${subject.id}`}))`);
      // A failed check keeps only its result (owner rule): no last 4.
      const replaced = { status: 'failed', failureReason: ID_REPLACED_REASON, last4: null };
      if (subject.type === 'job_seeker') {
        await tx.identityVerification.updateMany({ where: { jobSeekerId: subject.id, status: 'pending', vendor: 'team_lead_check' }, data: replaced });
        await tx.identityVerification.create({ data: { ...row, jobSeekerId: subject.id } });
      } else {
        await tx.referralIdentityVerification.updateMany({ where: { referralId: subject.id, status: 'pending', vendor: 'team_lead_check' }, data: replaced });
        await tx.referralIdentityVerification.create({ data: { ...row, referralId: subject.id } });
      }
      await tx.idCheckDetail.create({ data: { id: detailId, subjectType: subject.type, subjectId: subject.id, verificationId, kind: 'id_card_photo' } });
    });
    let stored = false;
    try {
      stored = await this.idPhotos.attachPhoto(detailId, IdCheckPhotoService.photoPath('id_card_photo', subject.type, subject.id, verificationId), photo.jpeg, 'image/jpeg', now);
    } catch (error) {
      this.logger.error(`ID card photo for ${verificationId} could not be recorded: ${(error as Error).message}`);
    }
    if (!stored) {
      // No card photo, nothing to check: the row must not sit "pending" (and hold up terms and
      // payment) with nothing behind it. It is closed as failed; he simply tries again.
      await this.closeAsFailed(subject.type, verificationId, PHOTO_NOT_SAVED_REASON);
      await this.prisma.idCheckDetail.deleteMany({ where: { id: detailId, photoPath: null } });
      throw new BadRequestException('The photo could not be saved. Try again.');
    }
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
    // Where no other Team Lead of the city can check it, a Manager or the CEO is told (rev 169).
    const route = await this.approvals.routeFor({ ...subject, subjectType: subject.type });
    if (route.mode === 'manager_or_ceo' && this.flags) {
      await this.flags.raise({
        kind: 'other_id_needs_manager',
        subjectType: subject.type,
        subjectId: subject.id,
        raisedForStaffId: subject.registeredByStaffId,
        details: { identityVerificationId: verificationId, method, city: subject.city, [subject.type === 'referral' ? 'referralCode' : 'jobSeekerCode']: subject.code },
        owner: { role: 'manager' },
      });
    }
    return { verificationId, method, status: 'pending', idNumberLast4: last4 };
  }

  private async closeAsFailed(subjectType: OtherIdSubjectType, verificationId: string, reason: string): Promise<void> {
    const data = { status: 'failed', failureReason: reason, last4: null };
    const where = { id: verificationId, status: 'pending' };
    if (subjectType === 'job_seeker') await this.prisma.identityVerification.updateMany({ where, data });
    else await this.prisma.referralIdentityVerification.updateMany({ where, data });
  }

  /**
   * The decision in T-Verify (or, where no other Team Lead can, by a Manager /
   * the CEO): "Looks right" approves a pending other ID (verified, name and 18+
   * confirmed by eye), "Fake · flag it" rejects it. Then every ID photo of the
   * person is deleted (audited).
   *
   * Refused, with nothing changed or deleted:
   *   - while an under-18 stop stands, any approval;
   *   - a decider who may not decide this ID (rev 169: never the person who
   *     registered them; own team's Team Lead / another Team Lead of the city /
   *     a Manager or the CEO);
   *   - an approval when the card photo is gone, or when this decider has not
   *     opened the photo (audit row identity.id_check_viewed with the photo link);
   *   - a decision someone else made a moment earlier (409).
   */
  async recordDecision(subjectType: OtherIdSubjectType, subjectId: string, verdict: 'ok' | 'fake', actor: { id: string; role: string }, now = new Date()) {
    const subject = await this.subject(subjectType, subjectId);
    if (verdict === 'ok' && (await this.stops.isStopped(subjectType, subjectId))) throw new BadRequestException(UNDER_18_STOP_MESSAGE);
    const pending =
      subjectType === 'job_seeker'
        ? await this.prisma.identityVerification.findFirst({ where: { jobSeekerId: subjectId, status: 'pending', vendor: 'team_lead_check' }, orderBy: { createdAt: 'desc' }, select: { id: true, method: true, last4: true, createdAt: true } })
        : await this.prisma.referralIdentityVerification.findFirst({ where: { referralId: subjectId, status: 'pending', vendor: 'team_lead_check' }, orderBy: { createdAt: 'desc' }, select: { id: true, method: true, last4: true, createdAt: true } });
    let otherIdDecided: 'verified' | 'failed' | null = null;
    if (pending) {
      const right = await this.approvals.rightFor(actor, { ...subject, subjectType: subject.type });
      if (!right.allowed) throw new ForbiddenException(right.reason);
      if (verdict === 'ok') {
        const detail = await this.prisma.idCheckDetail.findUnique({ where: { verificationId: pending.id }, select: { photoPath: true } });
        if (!detail?.photoPath) {
          // Nothing left to compare: the check closes (the person is asked for a new photo) instead of
          // staying pending, unapprovable, until the 30 days run out.
          await this.closeAsFailed(subjectType, pending.id, ID_PHOTO_EXPIRED_REASON);
          await this.audit.log({
            actorId: actor.id,
            action: 'identity.other_id_expired',
            entityType: subjectType === 'referral' ? 'referral_identity_verification' : 'identity_verification',
            entityCode: pending.id,
            before: { status: 'pending' },
            after: { status: 'failed', reason: 'photo_gone' },
            changedFields: ['status'],
          });
          throw new ConflictException(PHOTO_GONE_MESSAGE);
        }
        if (!(await this.idPhotos.hasViewedPhoto(actor.id, subjectType, subject.code, pending.id, pending.createdAt))) throw new BadRequestException(OPEN_PHOTO_FIRST_MESSAGE);
      }
      const data = verdict === 'ok'
        ? { status: 'verified', nameMatches: true, isAdult: true, verifiedAt: now, failureReason: null }
        : { status: 'failed', nameMatches: null, isAdult: null, verifiedAt: null, failureReason: 'Rejected by the Team Lead', last4: null };
      // Only a row still pending changes: two decisions at once can't both win.
      const where = { id: pending.id, status: 'pending' };
      const changed =
        subjectType === 'job_seeker'
          ? await this.prisma.identityVerification.updateMany({ where, data })
          : await this.prisma.referralIdentityVerification.updateMany({ where, data });
      if (changed.count !== 1) throw new ConflictException(ALREADY_DECIDED_MESSAGE);
      otherIdDecided = verdict === 'ok' ? 'verified' : 'failed';
      await this.audit.log({
        actorId: actor.id,
        action: verdict === 'ok' ? 'identity.other_id_approved' : 'identity.other_id_rejected',
        entityType: subjectType === 'referral' ? 'referral_identity_verification' : 'identity_verification',
        entityCode: pending.id,
        before: { status: 'pending' },
        // A rejected ID keeps only its result: its last 4 isn't written here either.
        after: { status: otherIdDecided, method: pending.method, ...(verdict === 'ok' ? { idNumberLast4: pending.last4 } : {}), approverRole: actor.role, approvalMode: right.mode },
        changedFields: ['status'],
      });
      // The "waiting for a Manager" flag is done with; it comes off the bells too.
      const waitingFlags = await this.prisma.reviewFlag.findMany({ where: { kind: 'other_id_needs_manager', subjectType, subjectId, status: 'open' }, select: { id: true } });
      for (const flag of waitingFlags) {
        await this.prisma.reviewFlag.updateMany({ where: { id: flag.id, status: 'open' }, data: { status: 'resolved', resolvedAt: now, resolvedByStaffId: actor.id } });
        await this.flags?.refreshBell(flag.id);
      }
    }
    const photosDeleted = await this.idPhotos.deletePhotos(subjectType, subjectId, verdict === 'ok' ? 'team_lead_approved' : 'team_lead_rejected', actor.id, now);
    return { otherIdDecided, photosDeleted };
  }
}
