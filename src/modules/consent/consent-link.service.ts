import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PublicLinkPurpose } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { ConsentClock } from './consent-clock';
import { ConsentService } from './consent.service';
import { MessagingService } from '../message/messaging.service';
import { OtpService } from '../../common/otp/otp.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { DEFAULT_NOTICE_VERSION } from './consent.constants';
import { PricingService } from '../pricing/pricing.service';
import {
  AgreementLanguage,
  BUSINESS_AGREEMENT_VERSION,
  AgreementTermsNumbers,
  maskAgreementPhone,
  renderBusinessAgreementTerms,
  renderSignedAgreementDocument,
} from './business-agreement.template';
import {
  REFERRAL_TERMS_VERSION,
  renderReferralTerms,
} from './referral-terms.template';
import { AGREEMENT_DOCUMENT_STORAGE, AgreementDocumentStorage } from './agreement-document.storage';
import { AuditService } from '../../common/audit/audit.service';
import { BusinessVerificationService } from '../business/business-verification.service';
import { publicLink } from '../../common/public-link';

interface ConsentLinkTokenBase {
  token: string;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
}

export type InterviewLinkPurpose = 'candidate_reply' | 'candidate_check' | 'owner_result';

export interface InterviewActionLinkRecord extends ConsentLinkTokenBase {
  subjectType: 'interview';
  interviewId: string;
  purpose: InterviewLinkPurpose;
  phone: string;
}

export type ConsentLinkTokenRecord = ConsentLinkTokenBase & (
  | { subjectType: 'job_seeker'; subjectId: string; jobSeekerId: string }
  | {
      subjectType: 'business';
      subjectId: string;
      businessId: string;
      businessPhone: string;
      createdByStaffId: string;
      agreement: AgreementTermsNumbers & {
        version: string;
        language: AgreementLanguage;
        termsHtml: string;
        termsHash: string;
      };
    }
  | {
      subjectType: 'referral';
      subjectId: string;
      referralId: string;
      partnerPhone: string;
      partnerName: string;
      createdByStaffId: string;
      terms: {
        referralPayoutPaise: number;
        version: string;
        language: AgreementLanguage;
        termsHtml: string;
        termsHash: string;
      };
    }
  | InterviewActionLinkRecord
);

export interface SubmitConsentDto {
  token: string;
  otpRequestId: string;
  otpCode?: string;
  purposes: string[];
  language?: string;
  signedName?: string;
}

export type ConsentLinkDetails =
  | {
      valid: true;
      subjectType: 'business';
      businessId: string;
      businessName: string;
      maskedPhone: string;
      preferredLanguage: AgreementLanguage;
      agreementTermsHtml: string;
    }
  | {
      valid: true;
      subjectType: 'job_seeker';
      jobSeekerId: string;
      candidateName: string;
      phone: string;
      preferredLanguage: string;
    }
  | {
      valid: true;
      subjectType: 'referral';
      referralId: string;
      partnerName: string;
      maskedPhone: string;
      preferredLanguage: AgreementLanguage;
      termsHtml: string;
      referralPayoutPaise: number;
    };

@Injectable()
export class ConsentLinkService {
  private readonly processingTokens = new Set<string>();
  private ttlMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private readonly prisma: PrismaService,
    private readonly publicLinks: PublicLinkStoreService,
    private readonly clock: ConsentClock,
    private readonly consentService: ConsentService,
    private readonly messagingService: MessagingService,
    private readonly otpService: OtpService,
    private readonly pricingService: PricingService,
    private readonly auditService: AuditService,
    private readonly businessVerificationService: BusinessVerificationService,
    @Inject(AGREEMENT_DOCUMENT_STORAGE) private readonly agreementStorage: AgreementDocumentStorage,
  ) {}

  setTtlMs(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  createInterviewActionToken(
    interviewId: string,
    purpose: InterviewLinkPurpose,
    phone: string,
    expiresAt: Date,
  ): Promise<string> {
    const linkPurpose: Record<InterviewLinkPurpose, PublicLinkPurpose> = {
      candidate_reply: 'offer_reply',
      candidate_check: 'interview_candidate_result',
      owner_result: 'interview_owner_result',
    };
    return this.publicLinks.create({
      purpose: linkPurpose[purpose], subjectType: 'interview', subjectId: interviewId,
      phone, expiresAt, metadata: { interviewPurpose: purpose },
    }).then(({ token }) => token);
  }

  async validateInterviewActionToken(token: string, purpose: InterviewLinkPurpose): Promise<InterviewActionLinkRecord> {
    const record = await this.validateToken(token);
    if (record.subjectType !== 'interview' || record.purpose !== purpose) {
      throw new BadRequestException('Invalid interview link token');
    }
    return record;
  }

  async consumeInterviewActionToken(token: string, purpose: InterviewLinkPurpose): Promise<InterviewActionLinkRecord> {
    const record = await this.validateInterviewActionToken(token, purpose);
    await this.publicLinks.markUsed(token, this.clock.now());
    return record;
  }

  async verifyInterviewOwnerOtp(token: string, requestId: string, code: string): Promise<InterviewActionLinkRecord> {
    const record = await this.validateInterviewActionToken(token, 'owner_result');
    const validCode = await this.otpService.verifyOtp(requestId, code);
    const belongsToOwner = validCode && await this.otpService.isVerified(requestId, record.phone);
    if (!belongsToOwner) throw new BadRequestException('Valid owner OTP is required to record an interview result');
    return record;
  }

  async createLink(jobSeekerId: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const { token } = await this.publicLinks.create({
      purpose: 'registration', subjectType: 'job_seeker', subjectId: seeker.id,
      phone: seeker.phone, expiresAt,
    });

    // Send single-use link via SMS
    await this.messagingService.send({
      channel: 'sms',
      template: 'consent_link',
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      variables: {
        token,
        link: publicLink(`/consent/${token}`),
      },
    });

    // NOTE: Job seeker's phone number must NEVER appear in this response
    return {
      success: true,
      token,
      expiresAt,
    };
  }

  async createAgreementLink(businessId: string, staffId: string, language: string = 'en') {
    if (!['kn', 'hi', 'en'].includes(language)) {
      throw new BadRequestException('language must be kn, hi, or en');
    }
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);

    const policy = await this.pricingService.current();
    const numbers = {
      noBypassMonths: policy.noBypassMonths,
      noBypassPenaltyPercent: policy.noBypassPenaltyPercent,
      feePercent: policy.placementFeePercent,
      gstPercent: policy.gstPercent,
    };
    const agreementLanguage = language as AgreementLanguage;
    const termsHtml = renderBusinessAgreementTerms(numbers, agreementLanguage);
    const termsHash = createHash('sha256').update(termsHtml, 'utf8').digest('hex');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const { token } = await this.publicLinks.create({
      purpose: 'business_agreement', subjectType: 'business', subjectId: business.id,
      phone: business.phone, language, createdByStaffId: staffId, expiresAt,
      metadata: { agreement: {
        ...numbers,
        version: BUSINESS_AGREEMENT_VERSION,
        language: agreementLanguage,
        termsHtml,
        termsHash,
      } },
    });

    await this.messagingService.send({
      channel: 'sms',
      template: 'agreement_link',
      subjectType: 'business',
      subjectId: business.id,
      variables: { token, link: publicLink(`/consent/${token}`) },
    });
    return { success: true, token, expiresAt };
  }

  async createReferralTermsLink(referralId: string, staffId: string, language: string = 'en') {
    if (!['kn', 'hi', 'en'].includes(language)) {
      throw new BadRequestException('language must be kn, hi, or en');
    }
    const referral = await this.prisma.referral.findUnique({ where: { id: referralId } });
    if (!referral) throw new NotFoundException(`Referral '${referralId}' not found`);

    const policy = await this.pricingService.current();
    const referralPayoutPaise = policy.referralPayoutPaise;
    const agreementLanguage = language as AgreementLanguage;
    const termsHtml = renderReferralTerms(referralPayoutPaise, agreementLanguage);
    const termsHash = createHash('sha256').update(termsHtml, 'utf8').digest('hex');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const { token } = await this.publicLinks.create({
      purpose: 'referral_registration', subjectType: 'referral', subjectId: referral.id,
      phone: referral.phone, language, createdByStaffId: staffId, expiresAt,
      metadata: { partnerName: referral.name, terms: {
        referralPayoutPaise,
        version: REFERRAL_TERMS_VERSION,
        language: agreementLanguage,
        termsHtml,
        termsHash,
      } },
    });

    await this.messagingService.send({
      channel: 'sms',
      template: 'referral_terms_link',
      subjectType: 'referral',
      subjectId: referral.id,
      variables: { token, link: publicLink(`/consent/${token}`) },
    });

    return { success: true, token, expiresAt };
  }

  async getSignedAgreementDocument(businessId: string) {
    const agreement = await this.prisma.businessAgreement.findFirst({
      where: { businessId }, orderBy: { signedAt: 'desc' },
      select: { documentStoragePath: true, termsHash: true },
    });
    if (!agreement) throw new NotFoundException('No signed agreement exists for this business');
    const body = await this.agreementStorage.get(agreement.documentStoragePath);
    if (!body) throw new NotFoundException('The signed agreement document is unavailable');
    return { body, termsHash: agreement.termsHash };
  }

  async validateToken(token: string): Promise<ConsentLinkTokenRecord> {
    let row: Awaited<ReturnType<PublicLinkStoreService['findByToken']>>;
    try {
      row = await this.publicLinks.findByToken(token, this.clock.now());
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw new BadRequestException('Invalid consent link token');
      if (error instanceof BadRequestException) {
        if (error.message === 'Public link has already been used') throw new BadRequestException('Consent link has already been used');
        if (error.message === 'Public link has expired') throw new BadRequestException('Consent link has expired');
      }
      throw error;
    }
    const base = { token, expiresAt: row.expiresAt, usedAt: row.usedAt, createdAt: row.createdAt };
    const metadata = (row.metadata ?? {}) as unknown as Record<string, unknown>;
    if (row.subjectType === 'interview') {
      const purposeByLink: Record<string, InterviewLinkPurpose> = {
        offer_reply: 'candidate_reply',
        interview_candidate_result: 'candidate_check',
        interview_owner_result: 'owner_result',
      };
      const purpose = purposeByLink[row.purpose];
      if (!purpose || !row.phone) throw new BadRequestException('Invalid interview link token');
      return { ...base, subjectType: 'interview', interviewId: row.subjectId, purpose, phone: row.phone };
    }
    if (row.purpose === 'business_agreement') {
      return { ...base, subjectType: 'business', subjectId: row.subjectId, businessId: row.subjectId,
        businessPhone: row.phone ?? '', createdByStaffId: row.createdByStaffId ?? '',
        agreement: metadata.agreement as Extract<ConsentLinkTokenRecord, { subjectType: 'business' }>['agreement'] };
    }
    if (row.purpose === 'referral_registration') {
      return { ...base, subjectType: 'referral', subjectId: row.subjectId, referralId: row.subjectId,
        partnerPhone: row.phone ?? '', partnerName: String(metadata.partnerName ?? ''),
        createdByStaffId: row.createdByStaffId ?? '',
        terms: metadata.terms as Extract<ConsentLinkTokenRecord, { subjectType: 'referral' }>['terms'] };
    }
    if (row.purpose === 'registration') {
      return { ...base, subjectType: 'job_seeker', subjectId: row.subjectId, jobSeekerId: row.subjectId };
    }
    throw new BadRequestException('Invalid consent link token');
  }

  async getTokenDetails(token: string): Promise<ConsentLinkDetails> {
    const record = await this.validateToken(token);
    if (record.subjectType === 'interview') {
      throw new BadRequestException('This token is not a consent or agreement link');
    }
    if (record.subjectType === 'business') {
      const business = await this.prisma.business.findUnique({ where: { id: record.businessId } });
      if (!business) throw new NotFoundException('Business not found');
      return {
        valid: true,
        subjectType: 'business',
        businessId: business.id,
        businessName: business.name,
        maskedPhone: maskAgreementPhone(record.businessPhone),
        preferredLanguage: record.agreement.language,
        agreementTermsHtml: record.agreement.termsHtml,
      };
    }

    if (record.subjectType === 'referral') {
      const referral = await this.prisma.referral.findUnique({ where: { id: record.referralId } });
      if (!referral) throw new NotFoundException('Referral partner not found');
      return {
        valid: true,
        subjectType: 'referral',
        referralId: referral.id,
        partnerName: referral.name,
        maskedPhone: maskAgreementPhone(record.partnerPhone),
        preferredLanguage: record.terms.language,
        termsHtml: record.terms.termsHtml,
        referralPayoutPaise: record.terms.referralPayoutPaise,
      };
    }

    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: record.jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException('Job seeker not found');
    }

    const firstLang = await this.prisma.jobSeekerLanguage.findFirst({
      where: { jobSeekerId: seeker.id },
    });
    const candidateLang = firstLang?.language?.toLowerCase() || 'kn';
    const preferredLanguage = ['kn', 'hi', 'en'].includes(candidateLang)
      ? candidateLang
      : 'kn';

    return {
      valid: true,
      subjectType: 'job_seeker',
      jobSeekerId: seeker.id,
      candidateName: seeker.name,
      phone: seeker.phone,
      preferredLanguage,
    };
  }

  async sendOtp(token: string) {
    const record = await this.validateToken(token);
    if (record.subjectType === 'interview') {
      if (record.purpose !== 'owner_result') {
        throw new BadRequestException('This interview link does not require OTP');
      }
      const otp = await this.otpService.sendOtp(record.phone);
      return { success: true, requestId: otp.requestId, phone: maskAgreementPhone(record.phone) };
    }
    if (record.subjectType === 'business') {
      const otp = await this.otpService.sendOtp(record.businessPhone);
      return { success: true, requestId: otp.requestId, phone: maskAgreementPhone(record.businessPhone) };
    }
    if (record.subjectType === 'referral') {
      const otp = await this.otpService.sendOtp(record.partnerPhone);
      return { success: true, requestId: otp.requestId, phone: maskAgreementPhone(record.partnerPhone) };
    }
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: record.jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException('Job seeker not found');
    }

    const otp = await this.otpService.sendOtp(seeker.phone);
    return {
      success: true,
      requestId: otp.requestId,
      phone: seeker.phone,
    };
  }

  async submitConsent(dto: SubmitConsentDto) {
    const record = await this.validateToken(dto.token);
    if (record.subjectType === 'interview') {
      throw new BadRequestException('This token is not a consent or agreement link');
    }
    if (this.processingTokens.has(record.token)) {
      throw new BadRequestException('Consent link submission is already processing');
    }
    this.processingTokens.add(record.token);
    try {
      if (record.subjectType === 'business') {
        return await this.submitBusinessAgreement(record, dto);
      }
      if (record.subjectType === 'referral') {
        return await this.submitReferralTerms(record, dto);
      }
      return await this.submitJobSeekerConsent(record, dto);
    } finally {
      this.processingTokens.delete(record.token);
    }
  }

  private async submitJobSeekerConsent(
    record: Extract<ConsentLinkTokenRecord, { subjectType: 'job_seeker' }>,
    dto: SubmitConsentDto,
  ) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: record.jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException('Job seeker not found');
    }

    // Verify OTP: either through otpCode or if already verified
    if (dto.otpCode) {
      const ok = await this.otpService.verifyOtp(dto.otpRequestId, dto.otpCode);
      if (!ok) {
        throw new BadRequestException('Invalid or expired OTP');
      }
    } else {
      const verified = await this.otpService.isVerified(dto.otpRequestId, seeker.phone);
      if (!verified) {
        throw new BadRequestException('OTP verification is required before submission');
      }
    }

    let language = dto.language;
    if (!language) {
      const firstLang = await this.prisma.jobSeekerLanguage.findFirst({
        where: { jobSeekerId: seeker.id },
      });
      const candidateLang = firstLang?.language?.toLowerCase() || 'kn';
      language = ['kn', 'hi', 'en'].includes(candidateLang) ? candidateLang : 'kn';
    }
    const purposes = Array.isArray(dto.purposes) ? dto.purposes : [];

    // Grant each selected purpose
    for (const purpose of purposes) {
      await this.consentService.grant({
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose,
        noticeVersion: DEFAULT_NOTICE_VERSION,
        language,
        method: 'sms_link',
        otpRequestId: dto.otpRequestId,
      });
    }

    // Mark token as used
    await this.publicLinks.markUsed(record.token, this.clock.now());

    // Move a lead forward after first consent, or reactivate a paused seeker once all required purposes are restored.
    const hasAll = await this.consentService.hasAllRequired('job_seeker', seeker.id);
    let finalStatus = seeker.status;

    if (hasAll && (seeker.status === 'lead' || seeker.status === 'paused')) {
      const nextStatus = seeker.status === 'lead' ? 'consented' : 'active';
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.jobSeeker.update({
          where: { id: seeker.id },
          data: { status: nextStatus, ...(nextStatus === 'active' ? { pausedAt: null } : {}) },
        });
        await recordStatusChange(tx, {
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          fromStatus: seeker.status,
          toStatus: nextStatus,
          changedByStaffId: null,
          reason: nextStatus === 'active'
            ? 'all_required_consents_restored_via_sms_link'
            : 'all_required_consents_granted_via_sms_link',
        });
        finalStatus = updated.status;
      });
    }

    return {
      success: true,
      status: finalStatus,
      grantedPurposes: purposes,
    };
  }

  private async submitBusinessAgreement(
    record: Extract<ConsentLinkTokenRecord, { subjectType: 'business' }>,
    dto: SubmitConsentDto,
  ) {
    const requiredPurposes = ['agreement_terms', 'call_recording'];
    const purposes = Array.isArray(dto.purposes) ? dto.purposes : [];
    if (
      purposes.length !== requiredPurposes.length ||
      requiredPurposes.some((purpose) => !purposes.includes(purpose))
    ) {
      throw new BadRequestException('Agreement terms and call recording consent are both required');
    }
    const signedName = dto.signedName?.trim();
    if (!signedName) throw new BadRequestException('signedName is required');
    const otpValid = dto.otpCode
      ? await this.otpService.verifyOtp(dto.otpRequestId, dto.otpCode)
      : false;
    const otpBelongsToOwner = otpValid
      ? await this.otpService.isVerified(dto.otpRequestId, record.businessPhone)
      : false;
    if (!otpBelongsToOwner) {
      throw new BadRequestException('Valid owner OTP is required to sign the agreement');
    }
    const business = await this.prisma.business.findUnique({ where: { id: record.businessId } });
    if (!business) throw new NotFoundException('Business not found');

    const documentStoragePath = `business-agreements/${record.businessId}/${this.publicLinks.hashToken(record.token)}.html`;
    const document = renderSignedAgreementDocument(record.agreement.termsHtml);
    const documentBytes = Buffer.from(document, 'utf8');
    const documentHash = createHash('sha256').update(documentBytes).digest('hex');
    if (documentHash !== record.agreement.termsHash) {
      throw new BadRequestException('Agreement document does not match the shown terms');
    }
    await this.agreementStorage.put(documentStoragePath, documentBytes, 'text/html; charset=utf-8');

    const signedAt = this.clock.now();
    const agreement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.businessAgreement.create({
        data: {
          businessId: business.id,
          version: record.agreement.version,
          termsHash: record.agreement.termsHash,
          noBypassMonths: record.agreement.noBypassMonths,
          noBypassPenaltyPercent: record.agreement.noBypassPenaltyPercent,
          feePercent: record.agreement.feePercent,
          gstPercent: record.agreement.gstPercent,
          signedName,
          signedPhone: maskAgreementPhone(record.businessPhone),
          otpRequestId: dto.otpRequestId,
          signedAt,
          documentStoragePath,
        },
      });
      for (const purpose of requiredPurposes) {
        await this.consentService.grant(
          {
            subjectType: 'business',
            subjectId: business.id,
            purpose,
            noticeVersion: record.agreement.version,
            language: record.agreement.language,
            method: 'sms_link',
            otpRequestId: dto.otpRequestId,
          },
          tx,
        );
      }
      return created;
    });

    await this.publicLinks.markUsed(record.token, signedAt);
    await this.businessVerificationService.advanceToPendingTlCheckIfReady(business.id);
    await this.auditService.log({
      actorId: record.createdByStaffId,
      action: 'business_agreement.signed_by_owner_otp',
      entityType: 'business_agreement',
      entityCode: agreement.id,
      after: {
        businessId: business.id,
        version: agreement.version,
        termsHash: agreement.termsHash,
        otpRequestId: agreement.otpRequestId,
      },
      changedFields: ['version', 'termsHash', 'otpRequestId', 'signedAt'],
      reason: 'Business owner signed on the SMS link after OTP verification',
      city: business.city,
    });
    return {
      success: true,
      agreementId: agreement.id,
      signedAt,
      grantedPurposes: requiredPurposes,
    };
  }

  private async submitReferralTerms(
    record: Extract<ConsentLinkTokenRecord, { subjectType: 'referral' }>,
    dto: SubmitConsentDto,
  ) {
    const requiredPurposes = ['agreement_terms', 'call_recording'];
    const purposes = Array.isArray(dto.purposes) ? dto.purposes : [];
    if (
      purposes.length !== requiredPurposes.length ||
      requiredPurposes.some((p) => !purposes.includes(p))
    ) {
      throw new BadRequestException('Agreement terms and call recording consent are both required');
    }

    const otpValid = dto.otpCode
      ? await this.otpService.verifyOtp(dto.otpRequestId, dto.otpCode)
      : false;
    const otpBelongsToPartner = otpValid
      ? await this.otpService.isVerified(dto.otpRequestId, record.partnerPhone)
      : false;
    if (!otpBelongsToPartner) {
      throw new BadRequestException('Valid owner OTP is required to sign referral terms');
    }

    const referral = await this.prisma.referral.findUnique({ where: { id: record.referralId } });
    if (!referral) throw new NotFoundException('Referral partner not found');

    const signedAt = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      for (const purpose of requiredPurposes) {
        await this.consentService.grant(
          {
            subjectType: 'referral',
            subjectId: referral.id,
            purpose,
            noticeVersion: record.terms.version,
            language: record.terms.language,
            method: 'sms_link',
            otpRequestId: dto.otpRequestId,
          },
          tx,
        );
      }
    });

    await this.publicLinks.markUsed(record.token, signedAt);

    await this.auditService.log({
      actorId: record.createdByStaffId,
      action: 'referral_terms_signed',
      entityType: 'referral',
      entityCode: referral.code,
      before: { termsSigned: false },
      after: {
        termsSigned: true,
        purposes: requiredPurposes,
        otpRequestId: dto.otpRequestId,
        version: record.terms.version,
      },
      changedFields: ['consents'],
      reason: 'Referral partner signed terms and call recording consent via SMS link OTP',
    });

    return {
      success: true,
      signedAt,
      grantedPurposes: requiredPurposes,
    };
  }
}
