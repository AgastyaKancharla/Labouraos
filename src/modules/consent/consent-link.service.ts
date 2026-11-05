import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
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
import { AGREEMENT_DOCUMENT_STORAGE, AgreementDocumentStorage } from './agreement-document.storage';
import { AuditService } from '../../common/audit/audit.service';
import { BusinessVerificationService } from '../business/business-verification.service';

interface ConsentLinkTokenBase {
  token: string;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
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
    };

@Injectable()
export class ConsentLinkService {
  private readonly tokens = new Map<string, ConsentLinkTokenRecord>();
  private readonly processingTokens = new Set<string>();
  private ttlMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private readonly prisma: PrismaService,
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

  async createLink(jobSeekerId: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const token = randomBytes(32).toString('hex');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    const record: ConsentLinkTokenRecord = {
      token,
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      jobSeekerId: seeker.id,
      expiresAt,
      usedAt: null,
      createdAt: now,
    };
    this.tokens.set(token, record);

    // Send single-use link via SMS
    await this.messagingService.send({
      channel: 'sms',
      template: 'consent_link',
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      variables: {
        token,
        link: `/consent/${token}`,
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
    const token = randomBytes(32).toString('hex');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const record: ConsentLinkTokenRecord = {
      token,
      subjectType: 'business',
      subjectId: business.id,
      businessId: business.id,
      businessPhone: business.phone,
      createdByStaffId: staffId,
      agreement: {
        ...numbers,
        version: BUSINESS_AGREEMENT_VERSION,
        language: agreementLanguage,
        termsHtml,
        termsHash,
      },
      expiresAt,
      usedAt: null,
      createdAt: now,
    };
    this.tokens.set(token, record);

    await this.messagingService.send({
      channel: 'sms',
      template: 'agreement_link',
      subjectType: 'business',
      subjectId: business.id,
      variables: { token, link: `/consent/${token}` },
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

  validateToken(token: string): ConsentLinkTokenRecord {
    const record = this.tokens.get(token);
    if (!record) {
      throw new BadRequestException('Invalid consent link token');
    }
    if (record.usedAt) {
      throw new BadRequestException('Consent link has already been used');
    }
    if (this.clock.now().getTime() > record.expiresAt.getTime()) {
      throw new BadRequestException('Consent link has expired');
    }
    return record;
  }

  async getTokenDetails(token: string): Promise<ConsentLinkDetails> {
    const record = this.validateToken(token);
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
    const record = this.validateToken(token);
    if (record.subjectType === 'business') {
      const otp = await this.otpService.sendOtp(record.businessPhone);
      return { success: true, requestId: otp.requestId, phone: maskAgreementPhone(record.businessPhone) };
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
    const record = this.validateToken(dto.token);
    if (this.processingTokens.has(record.token)) {
      throw new BadRequestException('Consent link submission is already processing');
    }
    this.processingTokens.add(record.token);
    try {
      if (record.subjectType === 'business') {
        return await this.submitBusinessAgreement(record, dto);
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
    record.usedAt = this.clock.now();

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

    const documentStoragePath = `business-agreements/${record.businessId}/${record.token}.html`;
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

    record.usedAt = signedAt;
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
}
