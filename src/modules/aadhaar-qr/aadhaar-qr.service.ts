import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { AadhaarQrPhotoService } from './aadhaar-qr-photo.service';
import { checkName } from './name-check';
import { jpeg2000ToJpeg } from './qr-photo';
import {
  areaAndPincode,
  genderFromQr,
  isAdultOn,
  maskedAadhaarReference,
  parseQrDateOfBirth,
  parseSecureQr,
  PhoneLink,
  phoneLinkStatus,
  qrIssuedAt,
  SECURE_QR_MESSAGES,
  SecureQrError,
  TrustedKey,
  verifySecureQrSignature,
} from './secure-qr.parser';
import { loadUidaiCertificates } from './uidai-certificates';

/** Lets the tests trust a throw-away key instead of UIDAI's certificates. */
export const AADHAAR_QR_TRUSTED_KEYS = 'AADHAAR_QR_TRUSTED_KEYS';

/** Attempts per person (link and Laboura Field together) before the check pauses. */
export const QR_ATTEMPTS_PER_HOUR = 10;
export const QR_ATTEMPTS_PER_DAY = 30;
/** Invalid-signature attempts in 24 hours that raise a fraud flag for the Team Lead. */
export const QR_BAD_SIGNATURES_BEFORE_FLAG = 3;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type QrSubjectType = 'job_seeker' | 'referral';
export type QrChannel = 'link' | 'field';
export type QrResult = 'verified' | 'name_mismatch' | 'under_18' | 'bad_signature' | 'old_qr' | 'unreadable';

/**
 * What the page gets back: the result, never the QR's raw data. The person's
 * own page also gets the name, date of birth and gender read from the card to
 * show on the green result; Laboura Field (an agent) does not.
 */
export interface AadhaarQrOutcome {
  verificationId: string | null;
  method: 'aadhaar_qr';
  status: 'verified' | 'failed';
  result: QrResult;
  verifiedByUidai: boolean;
  nameMatches: boolean | null;
  isAdult: boolean | null;
  phoneLinked: PhoneLink | null;
  maskedReference: string | null;
  person: { name: string; dateOfBirth: string; gender: string | null } | null;
  failureReason: string | null;
  /** Another ID is offered whenever the QR can't be read or the name doesn't match. */
  offerOtherId: boolean;
}

interface Subject {
  type: QrSubjectType;
  id: string;
  code: string;
  name: string;
  phone: string;
  city: string;
  registeredByStaffId: string | null;
}

/**
 * The in-house Aadhaar Secure QR check (Master Guide, "Aadhaar verification",
 * 14 Nov). The page reads the QR on the phone and sends only its text; this
 * service checks UIDAI's signature with UIDAI's public key, 18+, the name
 * against the registered name, and whether his OTP-verified phone is the one
 * linked to that Aadhaar (not linked: a flag for the Team Lead, not a block).
 *
 * Kept: verified yes/no, the method, the time, the QR's reference (last 4
 * digits + its time stamp), name, date of birth, gender, area, pincode, the
 * name / phone / 18+ results and the consent record; the QR photo only until
 * the Team Lead's check. Never kept, logged or sent anywhere: the QR text, the
 * inflated bytes, the full address, the email/mobile hashes or any full
 * Aadhaar number (the QR doesn't carry one).
 */
@Injectable()
export class AadhaarQrService {
  private readonly logger = new Logger(AadhaarQrService.name);
  private readonly keys: TrustedKey[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly flags: ReviewFlagService,
    private readonly qrPhotos: AadhaarQrPhotoService,
    @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photos: CandidatePhotoStorage,
    @Optional() @Inject(AADHAAR_QR_TRUSTED_KEYS) keys?: TrustedKey[],
  ) {
    this.keys = keys && keys.length ? keys : loadUidaiCertificates();
    if (!this.keys.length) this.logger.error('No UIDAI certificates found: every Aadhaar QR will fail its signature check');
  }

  /** The job seeker's own link or Laboura Field. Requires his aadhaar_verification consent. */
  async checkJobSeeker(jobSeekerId: string, qrText: unknown, context: { channel: QrChannel; staffId?: string | null; now?: Date }): Promise<AadhaarQrOutcome> {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
      select: { id: true, code: true, name: true, phone: true, phoneVerified: true, city: true, registeredByStaffId: true, anonymisedAt: true },
    });
    if (!seeker || seeker.anonymisedAt) throw new NotFoundException('Job seeker not found');
    const consent = await this.prisma.consent.findFirst({
      where: { subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'aadhaar_verification', granted: true, grantedAt: { not: null }, withdrawnAt: null },
      orderBy: { grantedAt: 'desc' },
      select: { id: true },
    });
    if (!consent) throw new BadRequestException('Consent for aadhaar_verification is required before the ID check');
    return this.check(
      { type: 'job_seeker', id: seeker.id, code: seeker.code, name: seeker.name, phone: seeker.phoneVerified ? seeker.phone : '', city: seeker.city, registeredByStaffId: seeker.registeredByStaffId },
      consent.id,
      qrText,
      context,
    );
  }

  /** The referral partner's link: the same ID step (consent there is the agreed referral terms). */
  async checkReferral(referralId: string, qrText: unknown, context: { channel: QrChannel; staffId?: string | null; now?: Date }): Promise<AadhaarQrOutcome> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: { id: true, code: true, name: true, phone: true, phoneVerified: true, city: true, registeredByStaffId: true },
    });
    if (!referral) throw new NotFoundException('Referral partner not found');
    const consent = await this.prisma.consent.findFirst({
      where: { subjectType: 'referral', subjectId: referral.id, purpose: 'agreement_terms', granted: true, grantedAt: { not: null }, withdrawnAt: null },
      orderBy: { grantedAt: 'desc' },
      select: { id: true },
    });
    if (!consent) throw new BadRequestException('Referral terms and call-recording consent are required before ID verification');
    return this.check(
      { type: 'referral', id: referral.id, code: referral.code, name: referral.name, phone: referral.phone, city: referral.city, registeredByStaffId: referral.registeredByStaffId },
      consent.id,
      qrText,
      context,
    );
  }

  private async check(subject: Subject, consentId: string, qrText: unknown, context: { channel: QrChannel; staffId?: string | null; now?: Date }): Promise<AadhaarQrOutcome> {
    const now = context.now ?? new Date();
    await this.assertWithinLimits(subject, now);

    let parsed;
    try {
      parsed = parseSecureQr(qrText);
    } catch (error) {
      if (!(error instanceof SecureQrError)) throw error;
      const result: QrResult = error.code === 'old_unsigned_qr' ? 'old_qr' : 'unreadable';
      await this.recordAttempt(subject, context, result, now);
      return this.failed(result, error.message);
    }
    if (!verifySecureQrSignature(parsed, this.keys)) {
      await this.recordAttempt(subject, context, 'bad_signature', now);
      await this.flagRepeatedBadSignatures(subject, context, now);
      return this.failed('bad_signature', SECURE_QR_MESSAGES.bad_signature);
    }

    const policy = await this.pricing.current();
    const dob = parseQrDateOfBirth(parsed.dateOfBirth);
    const isAdult = isAdultOn(dob, now, policy.adultMinimumAge);
    const name = checkName(subject.name, parsed.name);
    const phoneLinked = phoneLinkStatus(parsed, subject.phone);
    const { area, pincode } = areaAndPincode(parsed.address);
    const gender = genderFromQr(parsed.gender);
    const result: QrResult = !isAdult ? 'under_18' : !name.matches ? 'name_mismatch' : 'verified';
    const failureReason = result === 'under_18' ? 'Applicant is under 18' : result === 'name_mismatch' ? 'Name on the Aadhaar does not match the registered name' : null;
    const verificationId = randomUUID();
    const vendorReference = parsed.referenceId.slice(0, 4 + 17);
    const issuedAt = qrIssuedAt(parsed);

    // The photo goes to private storage only when a Team Lead check will follow (18+).
    let photoPath: string | null = null;
    if (isAdult && subject.type === 'job_seeker') {
      const jpeg = jpeg2000ToJpeg(parsed.photo);
      if (jpeg) {
        photoPath = AadhaarQrPhotoService.photoPath(subject.type, subject.id, verificationId);
        try {
          await this.photos.put(photoPath, jpeg, 'image/jpeg');
        } catch (error) {
          this.logger.warn(`Aadhaar QR photo could not be stored for ${subject.code}: ${(error as Error).message}`);
          photoPath = null;
        }
      }
    }
    if (photoPath) await this.qrPhotos.deletePhotos(subject.type, subject.id, 'replaced', context.staffId ?? 'system', now);

    const row = {
      id: verificationId,
      method: 'aadhaar_qr',
      vendor: 'uidai_secure_qr',
      vendorReference,
      // As for every ID check: "verified" only when all the checks pass. A row with
      // method aadhaar_qr exists only when UIDAI's signature passed.
      status: result === 'verified' ? 'verified' : 'failed',
      last4: parsed.referenceLast4,
      nameMatches: name.matches,
      isAdult,
      phoneLinked,
      qrIssuedAt: issuedAt,
      consentId,
      verifiedAt: result === 'verified' ? now : null,
      failureReason,
    };
    await this.prisma.$transaction(async (tx) => {
      if (subject.type === 'job_seeker') await tx.identityVerification.create({ data: { ...row, jobSeekerId: subject.id } });
      else await tx.referralIdentityVerification.create({ data: { ...row, referralId: subject.id } });
      await tx.aadhaarQrDetail.create({
        data: {
          subjectType: subject.type,
          subjectId: subject.id,
          verificationId,
          nameOnId: parsed.name,
          dateOfBirth: dob?.value ?? parsed.dateOfBirth.slice(0, 10),
          gender,
          area,
          pincode,
          photoPath,
          photoExpiresAt: photoPath ? AadhaarQrPhotoService.expiryFrom(now) : null,
        },
      });
    });
    await this.recordAttempt(subject, context, result, now);

    await this.audit.log({
      actorId: context.staffId ?? 'system',
      action: 'identity.aadhaar_qr_checked',
      entityType: subject.type,
      entityCode: subject.code,
      after: {
        verificationId,
        method: 'aadhaar_qr',
        channel: context.channel,
        verifiedByUidai: true,
        maskedReference: maskedAadhaarReference(parsed.referenceLast4),
        nameMatches: name.matches,
        isAdult,
        phoneLinked,
        photoKept: Boolean(photoPath),
      },
      changedFields: ['method', 'status', 'nameMatches', 'isAdult', 'phoneLinked'],
      reason: context.channel === 'field' ? 'Aadhaar QR scanned live in Laboura Field' : 'Aadhaar QR read on his own phone through his link',
      city: subject.city,
    });

    if (!name.matches) {
      await this.flags.raise({
        kind: 'name_check',
        subjectType: subject.type,
        subjectId: subject.id,
        raisedForStaffId: subject.registeredByStaffId,
        details: { identityVerificationId: verificationId, method: 'aadhaar_qr', reviewRequired: true, likelySpelling: name.likelySpelling },
      });
    }
    if (isAdult && phoneLinked === 'not_linked') {
      await this.flags.raise({
        kind: 'aadhaar_phone_not_linked',
        subjectType: subject.type,
        subjectId: subject.id,
        raisedForStaffId: subject.registeredByStaffId,
        details: { identityVerificationId: verificationId },
      });
    }

    return {
      verificationId,
      method: 'aadhaar_qr',
      status: result === 'verified' ? 'verified' : 'failed',
      result,
      verifiedByUidai: true,
      nameMatches: name.matches,
      isAdult,
      phoneLinked,
      maskedReference: maskedAadhaarReference(parsed.referenceLast4),
      person: context.channel === 'link' ? { name: parsed.name, dateOfBirth: dob?.value ?? '', gender } : null,
      failureReason,
      offerOtherId: result === 'name_mismatch',
    };
  }

  private failed(result: QrResult, message: string): AadhaarQrOutcome {
    return {
      verificationId: null,
      method: 'aadhaar_qr',
      status: 'failed',
      result,
      verifiedByUidai: false,
      nameMatches: null,
      isAdult: null,
      phoneLinked: null,
      maskedReference: null,
      person: null,
      failureReason: message,
      offerOtherId: true,
    };
  }

  /** At most QR_ATTEMPTS_PER_HOUR an hour and QR_ATTEMPTS_PER_DAY a day per person, link and field together. */
  private async assertWithinLimits(subject: Subject, now: Date): Promise<void> {
    const [lastHour, lastDay] = await Promise.all([
      this.prisma.aadhaarQrAttempt.count({ where: { subjectType: subject.type, subjectId: subject.id, attemptedAt: { gt: new Date(now.getTime() - HOUR_MS) } } }),
      this.prisma.aadhaarQrAttempt.count({ where: { subjectType: subject.type, subjectId: subject.id, attemptedAt: { gt: new Date(now.getTime() - DAY_MS) } } }),
    ]);
    if (lastHour >= QR_ATTEMPTS_PER_HOUR || lastDay >= QR_ATTEMPTS_PER_DAY) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: lastDay >= QR_ATTEMPTS_PER_DAY
            ? 'Too many Aadhaar QR tries today. Try again tomorrow, or use another ID.'
            : 'Too many Aadhaar QR tries. Wait an hour and try again, or use another ID.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordAttempt(subject: Subject, context: { channel: QrChannel; staffId?: string | null }, outcome: QrResult, now: Date): Promise<void> {
    await this.prisma.aadhaarQrAttempt.create({
      data: { subjectType: subject.type, subjectId: subject.id, channel: context.channel, outcome, staffId: context.staffId ?? null, attemptedAt: now },
    });
  }

  /** Repeated QR codes that fail UIDAI's signature: someone may be trying an edited card. One open flag at a time. */
  private async flagRepeatedBadSignatures(subject: Subject, context: { channel: QrChannel; staffId?: string | null }, now: Date): Promise<void> {
    const bad = await this.prisma.aadhaarQrAttempt.count({
      where: { subjectType: subject.type, subjectId: subject.id, outcome: 'bad_signature', attemptedAt: { gt: new Date(now.getTime() - DAY_MS) } },
    });
    if (bad < QR_BAD_SIGNATURES_BEFORE_FLAG) return;
    const open = await this.prisma.reviewFlag.findFirst({
      where: { kind: 'aadhaar_qr_tampered', subjectType: subject.type, subjectId: subject.id, status: 'open' },
      select: { id: true },
    });
    if (open) return;
    await this.flags.raise({
      kind: 'aadhaar_qr_tampered',
      subjectType: subject.type,
      subjectId: subject.id,
      raisedForStaffId: subject.registeredByStaffId,
      details: { invalidSignatureAttempts: bad, lastChannel: context.channel, ...(context.staffId ? { fieldAgentStaffId: context.staffId } : {}) },
    });
  }
}
