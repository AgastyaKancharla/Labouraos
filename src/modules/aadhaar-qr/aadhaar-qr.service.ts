import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { IdCheckPhotoService } from './id-check-photo.service';
import { checkIdName } from './id-name-check';
import { jpeg2000ToJpeg } from './qr-photo';
import {
  areaAndPincode,
  genderFromQr,
  isAdultOn,
  maskedAadhaarReference,
  newestCertificateEnd,
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
import { Under18StopService } from './under18-stop.service';

/** Lets the tests trust a throw-away key instead of UIDAI's certificates. Refused in production. */
export const AADHAAR_QR_TRUSTED_KEYS = 'AADHAAR_QR_TRUSTED_KEYS';

/** Attempts per person (link and Laboura Field together) before the check pauses. */
export const QR_ATTEMPTS_PER_HOUR = 10;
export const QR_ATTEMPTS_PER_DAY = 30;
/** Invalid-signature attempts in 24 hours that raise a fraud flag for the Team Lead (once per person). */
export const QR_BAD_SIGNATURES_BEFORE_FLAG = 3;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type QrSubjectType = 'job_seeker' | 'referral';
export type QrChannel = 'link' | 'field';
export type QrResult = 'verified' | 'name_mismatch' | 'under_18' | 'bad_signature' | 'cert_missing' | 'old_qr' | 'unreadable';

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
  /** Another ID is offered whenever the QR can't be used or the name doesn't match. */
  offerOtherId: boolean;
}

interface Subject {
  type: QrSubjectType;
  id: string;
  code: string;
  name: string;
  /** His OTP-verified phone, or '' when it isn't verified. */
  phone: string;
  city: string;
  registeredByStaffId: string | null;
}

interface Context {
  channel: QrChannel;
  staffId?: string | null;
  now?: Date;
}

/**
 * The in-house Aadhaar Secure QR check (Master Guide, "Aadhaar verification",
 * 14 Nov). The page reads the QR on the phone and sends only its text; this
 * service checks UIDAI's signature with UIDAI's public key, 18+, the name
 * against the registered name, and whether his OTP-verified phone is the one
 * linked to that Aadhaar (not linked: a flag for the Team Lead, not a block).
 *
 * Kept: verified yes/no, the method, the time, the QR's reference (last 4
 * digits + its time stamp), the name / phone / 18+ results and the consent
 * record; for a QR that passes every check also name, date of birth, gender,
 * area and pincode, and the QR photo until the Team Lead's check. Never kept,
 * logged or sent anywhere: the QR text, the inflated bytes, the full address,
 * the email/mobile hashes or any full Aadhaar number (the QR doesn't carry one).
 */
@Injectable()
export class AadhaarQrService {
  private readonly logger = new Logger(AadhaarQrService.name);
  private readonly keys: TrustedKey[];
  private readonly newestCertEnd: Date | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly flags: ReviewFlagService,
    private readonly idPhotos: IdCheckPhotoService,
    private readonly stops: Under18StopService,
    @Optional() @Inject(AADHAAR_QR_TRUSTED_KEYS) keys?: TrustedKey[],
  ) {
    if (keys?.length && process.env.NODE_ENV === 'production') {
      throw new Error('Test keys for the Aadhaar QR check are never allowed in production');
    }
    this.keys = keys && keys.length ? keys : loadUidaiCertificates();
    this.newestCertEnd = newestCertificateEnd(this.keys);
    if (!this.keys.length) this.logger.error('No UIDAI certificates found: every Aadhaar QR will fail its signature check');
  }

  /** The job seeker's own link or Laboura Field. Requires his aadhaar_verification consent and the selfie. */
  async checkJobSeeker(jobSeekerId: string, qrText: unknown, context: Context): Promise<AadhaarQrOutcome> {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
      select: { id: true, code: true, name: true, phone: true, phoneVerified: true, city: true, registeredByStaffId: true, anonymisedAt: true, photoStoragePath: true },
    });
    if (!seeker || seeker.anonymisedAt) throw new NotFoundException('Job seeker not found');
    const consent = await this.prisma.consent.findFirst({
      where: { subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'aadhaar_verification', granted: true, grantedAt: { not: null }, withdrawnAt: null },
      orderBy: { grantedAt: 'desc' },
      select: { id: true },
    });
    if (!consent) throw new BadRequestException('Consent for aadhaar_verification is required before the ID check');
    if (!seeker.photoStoragePath) throw new BadRequestException('Take the selfie first');
    await this.stops.assertNotStopped('job_seeker', seeker.id);
    return this.check(
      { type: 'job_seeker', id: seeker.id, code: seeker.code, name: seeker.name, phone: seeker.phoneVerified ? seeker.phone : '', city: seeker.city, registeredByStaffId: seeker.registeredByStaffId },
      consent.id,
      qrText,
      context,
    );
  }

  /** The referral partner's link: the same ID step (consent there is the agreed referral terms). */
  async checkReferral(referralId: string, qrText: unknown, context: Context): Promise<AadhaarQrOutcome> {
    const referral = await this.prisma.referral.findUnique({
      where: { id: referralId },
      select: { id: true, code: true, name: true, phone: true, phoneVerified: true, city: true, registeredByStaffId: true, anonymisedAt: true },
    });
    if (!referral || referral.anonymisedAt) throw new NotFoundException('Referral partner not found');
    const consent = await this.prisma.consent.findFirst({
      where: { subjectType: 'referral', subjectId: referral.id, purpose: 'agreement_terms', granted: true, grantedAt: { not: null }, withdrawnAt: null },
      orderBy: { grantedAt: 'desc' },
      select: { id: true },
    });
    if (!consent) throw new BadRequestException('Referral terms and call-recording consent are required before ID verification');
    await this.stops.assertNotStopped('referral', referral.id);
    return this.check(
      { type: 'referral', id: referral.id, code: referral.code, name: referral.name, phone: referral.phoneVerified ? referral.phone : '', city: referral.city, registeredByStaffId: referral.registeredByStaffId },
      consent.id,
      qrText,
      context,
    );
  }

  private async check(subject: Subject, consentId: string, qrText: unknown, context: Context): Promise<AadhaarQrOutcome> {
    const now = context.now ?? new Date();
    const attemptId = await this.claimAttempt(subject, context, now);

    let parsed;
    try {
      parsed = parseSecureQr(qrText);
    } catch (error) {
      if (!(error instanceof SecureQrError)) throw error;
      const result: QrResult = error.code === 'old_unsigned_qr' ? 'old_qr' : 'unreadable';
      await this.finishAttempt(attemptId, result);
      return this.failed(result, error.message);
    }
    if (!verifySecureQrSignature(parsed, this.keys)) {
      // A code made after the newest certificate we hold: UIDAI has a newer key we don't have yet.
      const issued = qrIssuedAt(parsed);
      if (issued && this.newestCertEnd && issued.getTime() > this.newestCertEnd.getTime()) {
        await this.finishAttempt(attemptId, 'cert_missing');
        await this.flagCertificateMissing(now);
        return this.failed('cert_missing', SECURE_QR_MESSAGES.cert_missing);
      }
      await this.finishAttempt(attemptId, 'bad_signature');
      await this.flagRepeatedBadSignatures(subject, context, now);
      return this.failed('bad_signature', SECURE_QR_MESSAGES.bad_signature);
    }

    const policy = await this.pricing.current();
    const dob = parseQrDateOfBirth(parsed.dateOfBirth);
    const isAdult = isAdultOn(dob, now, policy.adultMinimumAge);
    const name = checkIdName(subject.name, parsed.name);
    const phoneLinked = phoneLinkStatus(parsed, subject.phone);
    const result: QrResult = !isAdult ? 'under_18' : !name.matches ? 'name_mismatch' : 'verified';
    const passed = result === 'verified';
    const failureReason = result === 'under_18' ? 'Applicant is under 18' : result === 'name_mismatch' ? 'Name on the Aadhaar does not match the registered name' : null;
    const verificationId = randomUUID();
    const issuedAt = qrIssuedAt(parsed);
    const row = {
      id: verificationId,
      method: 'aadhaar_qr',
      vendor: 'uidai_secure_qr',
      vendorReference: parsed.referenceId.slice(0, 4 + 17),
      // As for every ID check: "verified" only when all the checks pass. A row with
      // vendor uidai_secure_qr exists only when UIDAI's signature passed.
      status: passed ? 'verified' : 'failed',
      last4: parsed.referenceLast4,
      nameMatches: name.matches,
      isAdult,
      phoneLinked,
      qrIssuedAt: issuedAt,
      consentId,
      verifiedAt: passed ? now : null,
      failureReason,
    };
    // Name, date of birth, gender, area and pincode only for a QR that passed every check.
    const { area, pincode } = areaAndPincode(parsed.address);
    const gender = genderFromQr(parsed.gender);
    const detailId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      if (subject.type === 'job_seeker') await tx.identityVerification.create({ data: { ...row, jobSeekerId: subject.id } });
      else await tx.referralIdentityVerification.create({ data: { ...row, referralId: subject.id } });
      if (passed) {
        await tx.idCheckDetail.create({
          data: { id: detailId, subjectType: subject.type, subjectId: subject.id, verificationId, kind: 'aadhaar_qr', nameOnId: parsed.name, dateOfBirth: dob?.value ?? null, gender, area, pincode },
        });
      }
    });
    await this.finishAttempt(attemptId, result);

    // The QR photo, after the rows are committed, for the Team Lead's check of a job seeker —
    // unless the Team Lead has already decided on this registration.
    let photoKept = false;
    if (passed && subject.type === 'job_seeker') {
      const decided = await this.prisma.teamLeadCheck.findFirst({ where: { subjectType: 'job_seeker', subjectId: subject.id }, select: { id: true } });
      const jpeg = decided ? null : jpeg2000ToJpeg(parsed.photo);
      if (jpeg) {
        photoKept = await this.idPhotos.attachPhoto(detailId, IdCheckPhotoService.photoPath('aadhaar_qr', subject.type, subject.id, verificationId), jpeg, 'image/jpeg', now);
        if (photoKept) await this.idPhotos.deletePhotos(subject.type, subject.id, 'replaced', context.staffId ?? 'system', now, verificationId);
      }
    }

    await this.audit.log({
      actorId: context.staffId ?? 'system',
      action: 'identity.aadhaar_qr_checked',
      entityType: subject.type,
      entityCode: subject.code,
      after: {
        verificationId,
        method: 'aadhaar_qr',
        channel: context.channel,
        result,
        verifiedByUidai: true,
        maskedReference: maskedAadhaarReference(parsed.referenceLast4),
        nameMatches: name.matches,
        isAdult,
        phoneLinked,
        photoKept,
      },
      changedFields: ['method', 'status', 'nameMatches', 'isAdult', 'phoneLinked'],
      reason: context.channel === 'field' ? 'Aadhaar QR scanned live in Laboura Field' : 'Aadhaar QR read on his own phone through his link',
      city: subject.city,
    });

    if (!name.matches && isAdult) {
      await this.flags.raise({
        kind: 'name_check',
        subjectType: subject.type,
        subjectId: subject.id,
        raisedForStaffId: subject.registeredByStaffId,
        details: { identityVerificationId: verificationId, method: 'aadhaar_qr', reviewRequired: true, reason: name.reason, likelySpelling: name.likelySpelling },
      });
    }
    if (passed && phoneLinked === 'not_linked') {
      await this.flags.raise({
        kind: 'aadhaar_phone_not_linked',
        subjectType: subject.type,
        subjectId: subject.id,
        raisedForStaffId: subject.registeredByStaffId,
        details: { identityVerificationId: verificationId },
      });
    }
    if (passed && dob) await this.flagDuplicatePerson(subject, verificationId, parsed.referenceLast4, dob.value, parsed.name);

    return {
      verificationId,
      method: 'aadhaar_qr',
      status: passed ? 'verified' : 'failed',
      result,
      verifiedByUidai: true,
      nameMatches: name.matches,
      isAdult,
      phoneLinked,
      maskedReference: maskedAadhaarReference(parsed.referenceLast4),
      person: passed && context.channel === 'link' ? { name: parsed.name, dateOfBirth: dob?.value ?? '', gender } : null,
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

  /**
   * Counts and records the attempt in one transaction, under a lock on this
   * person, so parallel requests can't slip past the limit. At most
   * QR_ATTEMPTS_PER_HOUR an hour and QR_ATTEMPTS_PER_DAY a day, link and field together.
   */
  private async claimAttempt(subject: Subject, context: Context, now: Date): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`aadhaar-qr:${subject.type}:${subject.id}`}))`);
      const [lastHour, lastDay] = await Promise.all([
        tx.aadhaarQrAttempt.count({ where: { subjectType: subject.type, subjectId: subject.id, attemptedAt: { gt: new Date(now.getTime() - HOUR_MS) } } }),
        tx.aadhaarQrAttempt.count({ where: { subjectType: subject.type, subjectId: subject.id, attemptedAt: { gt: new Date(now.getTime() - DAY_MS) } } }),
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
      const attempt = await tx.aadhaarQrAttempt.create({
        data: { subjectType: subject.type, subjectId: subject.id, channel: context.channel, outcome: 'started', staffId: context.staffId ?? null, attemptedAt: now },
      });
      return attempt.id;
    });
  }

  private async finishAttempt(id: string, outcome: QrResult): Promise<void> {
    await this.prisma.aadhaarQrAttempt.update({ where: { id }, data: { outcome } });
  }

  /** Repeated QR codes that fail UIDAI's signature: someone may be trying an edited card. One flag per person, ever. */
  private async flagRepeatedBadSignatures(subject: Subject, context: Context, now: Date): Promise<void> {
    const shouldFlag = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`aadhaar-qr-flag:${subject.type}:${subject.id}`}))`);
      const bad = await tx.aadhaarQrAttempt.count({
        where: { subjectType: subject.type, subjectId: subject.id, outcome: 'bad_signature', attemptedAt: { gt: new Date(now.getTime() - DAY_MS) } },
      });
      if (bad < QR_BAD_SIGNATURES_BEFORE_FLAG) return null;
      const existing = await tx.reviewFlag.findFirst({ where: { kind: 'aadhaar_qr_tampered', subjectType: subject.type, subjectId: subject.id }, select: { id: true } });
      return existing ? null : bad;
    });
    if (shouldFlag === null) return;
    await this.flags.raise({
      kind: 'aadhaar_qr_tampered',
      subjectType: subject.type,
      subjectId: subject.id,
      raisedForStaffId: subject.registeredByStaffId,
      details: { invalidSignatureAttempts: shouldFlag, lastChannel: context.channel, ...(context.staffId ? { fieldAgentStaffId: context.staffId } : {}) },
    });
  }

  /** A card newer than our newest UIDAI certificate: not fraud — the CEO adds the new certificate. At most once a day. */
  private async flagCertificateMissing(now: Date): Promise<void> {
    const recent = await this.prisma.reviewFlag.findFirst({
      where: { kind: 'aadhaar_cert_missing', raisedAt: { gt: new Date(now.getTime() - DAY_MS) } },
      select: { id: true },
    });
    if (recent) return;
    await this.flags.raise({
      kind: 'aadhaar_cert_missing',
      subjectType: 'system',
      subjectId: 'uidai-certificates',
      raisedForStaffId: null,
      details: { newestCertificateValidTo: this.newestCertEnd?.toISOString() ?? null, action: 'Download the current UIDAI offline e-KYC certificate and add it to src/modules/aadhaar-qr/certs' },
    });
  }

  /** The same Aadhaar (last 4 + date of birth + name on it) already verified for someone else: a flag for the Manager, never a block. */
  private async flagDuplicatePerson(subject: Subject, verificationId: string, last4: string, dateOfBirth: string, nameOnId: string): Promise<void> {
    const sameCard = await this.prisma.idCheckDetail.findMany({
      where: { kind: 'aadhaar_qr', dateOfBirth, nameOnId: { equals: nameOnId, mode: 'insensitive' }, NOT: { subjectType: subject.type, subjectId: subject.id } },
      select: { subjectType: true, subjectId: true, verificationId: true },
      take: 20,
    });
    const others: { subjectType: string; subjectId: string }[] = [];
    for (const other of sameCard) {
      const verified =
        other.subjectType === 'job_seeker'
          ? await this.prisma.identityVerification.findFirst({ where: { id: other.verificationId, last4, status: 'verified' }, select: { id: true } })
          : await this.prisma.referralIdentityVerification.findFirst({ where: { id: other.verificationId, last4, status: 'verified' }, select: { id: true } });
      if (verified) others.push({ subjectType: other.subjectType, subjectId: other.subjectId });
    }
    if (!others.length) return;
    await this.flags.raise({
      kind: 'aadhaar_duplicate_person',
      subjectType: subject.type,
      subjectId: subject.id,
      raisedForStaffId: subject.registeredByStaffId,
      details: { identityVerificationId: verificationId, sameAadhaarAs: others.slice(0, 5) },
      owner: { role: 'manager' },
    });
  }
}
