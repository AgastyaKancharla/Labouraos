import { PRODUCT_LANGUAGE, productLanguage } from '../../common/language/english-only';
import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { codedError } from '../../common/http/coded-error';
import { createHash } from 'crypto';
import { PublicLinkPurpose } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { ConsentClock } from './consent-clock';
import { ConsentService } from './consent.service';
import { MessagingService } from '../message/messaging.service';
import { OtpService } from '../../common/otp/otp.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { DEFAULT_NOTICE_VERSION, JOB_SEEKER_CONSENT_PURPOSES, JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from './consent.constants';
import { PricingService } from '../pricing/pricing.service';
import {
  AgreementLanguage,
  AgreementTermsNumbers,
  maskAgreementPhone,
  renderSignedAgreementDocument,
} from './business-agreement.template';
import { LegalDocumentService, LegalStatus } from '../legal/legal-document.service';
import { formatIstDateTime } from '../legal/legal-dates';
import { AGREEMENT_DOCUMENT_STORAGE, AgreementDocumentStorage } from './agreement-document.storage';
import { AuditService } from '../../common/audit/audit.service';
import { BusinessVerificationService } from '../business/business-verification.service';
import { publicPageLink, PublicPage } from '../../common/public-pages';
import { PublicOtpLimiter } from '../../common/public-otp-limiter.service';
import { testModeFields } from '../../common/otp/otp-test-mode';

/**
 * Agreement links sent to a business owner by SMS (rev 188; rev 192 fix S2): at most one a
 * minute and five in 24 hours per business, on every path that sends one (the business form's
 * first link, the office, "Resend agreement link" in Laboura Field). One counter: the
 * business's live (not withdrawn) agreement links created in the last 24 hours.
 */
export const AGREEMENT_LINK_MIN_GAP_MS = 60 * 1000;
export const AGREEMENT_LINK_MAX_PER_DAY = 5;
export const AGREEMENT_LINK_WINDOW_MS = 24 * 3600 * 1000;

export type AgreementLinkWindow = { allowedNow: boolean; retryAt: Date | null; limit: 'gap' | 'day' | null };

/** Whether another agreement link may be sent now, from the links of the last 24 hours (newest first). */
export function agreementLinkWindow(recentLinks: Date[], now: Date): AgreementLinkWindow {
  const latest = recentLinks[0];
  if (latest && now.getTime() - latest.getTime() < AGREEMENT_LINK_MIN_GAP_MS) {
    return { allowedNow: false, retryAt: new Date(latest.getTime() + AGREEMENT_LINK_MIN_GAP_MS), limit: 'gap' };
  }
  if (recentLinks.length >= AGREEMENT_LINK_MAX_PER_DAY) {
    const oldest = recentLinks[AGREEMENT_LINK_MAX_PER_DAY - 1];
    return { allowedNow: false, retryAt: new Date(oldest.getTime() + AGREEMENT_LINK_WINDOW_MS), limit: 'day' };
  }
  return { allowedNow: true, retryAt: null, limit: null };
}

interface ConsentLinkTokenBase {
  token: string;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
  /** "customer:<accountId>" when the link was issued to the signed-in person in the Laboura app. */
  issuedTo?: string | null;
}

/** Consent given on a link opened inside the Laboura app is recorded as in_app, not sms_link. */
export function consentMethodFor(record: { issuedTo?: string | null }): 'in_app' | 'sms_link' {
  return typeof record.issuedTo === 'string' && record.issuedTo.startsWith('customer:') ? 'in_app' : 'sms_link';
}

export type InterviewLinkPurpose = 'candidate_reply' | 'candidate_check' | 'owner_result';

export interface InterviewActionLinkRecord extends ConsentLinkTokenBase {
  subjectType: 'interview';
  interviewId: string;
  purpose: InterviewLinkPurpose;
  phone: string;
}

export type ConsentLinkTokenRecord = ConsentLinkTokenBase & (
  | { subjectType: 'job_seeker'; subjectId: string; jobSeekerId: string; resumable?: boolean }
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
        /** "In short" and the full text of termsHtml, for P04 (v1.1). */
        summaryHtml?: string;
        bodyHtml?: string;
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
        summaryHtml?: string;
        bodyHtml?: string;
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
  /** sha256 of the terms text the page showed (GET /legal/documents/:key → hash); a mismatch is refused. */
  textHash?: string;
}

/** The terms text changed (Settings or a new version) while the person was reading it. */
export const TERMS_TEXT_CHANGED_MESSAGE = 'The terms have changed while you were reading. Please read the updated text and accept again.';

export type ConsentLinkDetails =
  | {
      valid: true;
      subjectType: 'business';
      businessId: string;
      businessName: string;
      maskedPhone: string;
      preferredLanguage: AgreementLanguage;
      agreementTermsHtml: string;
      /** v1.1: the "In short" box and the full text shown under "Read the full terms". */
      agreementSummaryHtml: string | null;
      agreementBodyHtml: string | null;
      version: string;
      /** The version this business accepted before (re-signing a newer version), if any. */
      previousVersion: string | null;
      /** Pre-fills "Your full name" (P04); the signer can change it. */
      ownerName: string | null;
      /** The numbers frozen when the link was sent, for the summary cards (P04). */
      terms: { feePercent: number; gstPercent: number; noBypassMonths: number; noBypassPenaltyPercent: number };
      guarantee: { replacementWindowDays: number; maxFreeReplacements: number; replacementSearchDays: number };
    }
  | {
      valid: true;
      subjectType: 'job_seeker';
      jobSeekerId: string;
      candidateName: string;
      phone: string;
      preferredLanguage: string;
      currentStep: 'consent' | 'selfie' | 'id_check' | 'payment' | 'complete';
      otpRequired: false;
      /** Accepted an older version of the terms / consent notice: the blocking re-consent screen first. */
      reconsent: LegalStatus | null;
    }
  | {
      valid: true;
      subjectType: 'job_seeker';
      otpRequired: true;
      maskedPhone: string;
      preferredLanguage: string;
    }
  | {
      valid: true;
      subjectType: 'referral';
      otpRequired: true;
      maskedPhone: string;
      preferredLanguage: AgreementLanguage;
    }
  | {
      valid: true;
      subjectType: 'referral';
      otpRequired: false;
      referralId: string;
      partnerName: string;
      maskedPhone: string;
      preferredLanguage: AgreementLanguage;
      termsHtml: string;
      summaryHtml: string | null;
      bodyHtml: string | null;
      version: string;
      referralPayoutPaise: number;
      reconsent: LegalStatus | null;
    };

/** How a link goes out: SMS (default) or WhatsApp with SMS as fallback (21 Nov, rev 202). */
export type LinkSendChannel = 'sms' | 'whatsapp';

@Injectable()
export class ConsentLinkService {
  private readonly processingTokens = new Set<string>();
  private ttlMs = 24 * 60 * 60 * 1000; // 24 hours
  /** Set only by setTtlMs (tests); otherwise Settings → registrationLinkValidHours decides. */
  private registrationTtlOverrideMs: number | null = null;

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
    private readonly otpLimiter: PublicOtpLimiter,
    private readonly legal: LegalDocumentService,
  ) {}

  setTtlMs(ttlMs: number) {
    this.ttlMs = ttlMs;
    this.registrationTtlOverrideMs = ttlMs;
  }

  /** C-Pricing "Registration link valid" (PricingPolicy.registrationLinkValidHours, 48 by default). */
  private async registrationTtl(allowOverride = true): Promise<number> {
    if (allowOverride && this.registrationTtlOverrideMs !== null) return this.registrationTtlOverrideMs;
    const policy = await this.pricingService.current();
    const hours = Number.isInteger(policy.registrationLinkValidHours) && policy.registrationLinkValidHours > 0 ? policy.registrationLinkValidHours : 48;
    return hours * 60 * 60 * 1000;
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
    // AC-3: only a code sent from this link's own page, used up by this result.
    const belongsToOwner = validCode && await this.otpService.consumeVerifiedForPage(requestId, record.phone, token);
    if (!belongsToOwner) throw new BadRequestException('Valid owner OTP is required to record an interview result');
    return record;
  }

  /**
   * `options.sms: false` (customer app): the link is opened by the signed-in
   * person inside the app, so no SMS is sent; everything else is the same.
   */
  async createLink(jobSeekerId: string, options: { sms?: boolean; issuedTo?: string; revokeOthers?: boolean; channel?: LinkSendChannel } = {}) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + (await this.registrationTtl()));
    // A link opened inside the app (revokeOthers: false) leaves the agent's SMS link working.
    if (options.revokeOthers !== false) await this.publicLinks.revokeActive('registration', 'job_seeker', seeker.id, now);
    const { token, id } = await this.publicLinks.create({
      purpose: 'registration', subjectType: 'job_seeker', subjectId: seeker.id,
      phone: seeker.phone, expiresAt, metadata: { resumable: true, ...(options.issuedTo ? { issuedTo: options.issuedTo } : {}) },
    });

    // Send single-use link via SMS ("Send on WhatsApp", rev 202: WhatsApp first, SMS as fallback)
    const sentBy = options.sms === false ? null : await this.sendLinkMessage(options.channel, {
      template: 'consent_link',
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      variables: {
        token,
        link: publicPageLink('registration', token),
      },
    });

    // NOTE: Job seeker's phone number must NEVER appear in this response. The token
    // is for the customer app (opened in-app); staff routes strip it (AC-3).
    return {
      success: true,
      token,
      linkId: id,
      expiresAt,
      sentBy,
    };
  }

  /**
   * Sends a link message: by SMS as before, or with `channel: 'whatsapp'` on
   * WhatsApp first and by SMS when WhatsApp is not available or fails (21 Nov).
   * Returns the channel that carried it, or null when nothing went out.
   */
  private async sendLinkMessage(
    channel: LinkSendChannel | undefined,
    message: { template: string; subjectType: string; subjectId: string; variables: Record<string, string> },
  ): Promise<'sms' | 'whatsapp' | null> {
    if (channel === 'whatsapp') {
      const result = await this.messagingService.sendPreferWhatsApp({ ...message, contactAttempt: false });
      return result.channel;
    }
    const row = await this.messagingService.send({ channel: 'sms', ...message });
    // A test double may answer nothing (treated as sent); failed or blocked (wrong number / do not call) is not sent.
    if (!row) return 'sms';
    return row.status === 'failed' || row.status === 'blocked' ? null : 'sms';
  }

  /** The agreement link, in English (rev 193; a language an older client sends is ignored). */
  async createAgreementLink(businessId: string, staffId: string | null, _requestedLanguage?: string, options: { sms?: boolean; issuedTo?: string; channel?: LinkSendChannel } = {}) {
    const language = productLanguage(_requestedLanguage);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);

    const policy = await this.pricingService.current();
    const numbers = {
      noBypassMonths: policy.noBypassMonths,
      noBypassPenaltyPercent: policy.noBypassPenaltyPercent,
      feePercent: policy.placementFeePercent,
      gstPercent: policy.gstPercent,
    };
    const agreementLanguage: AgreementLanguage = language;
    // The FULL v1.1 agreement (S1), with the numbers frozen as of today.
    const rendered = await this.legal.render('business_agreement', agreementLanguage, {
      placementFeePercent: numbers.feePercent,
      gstPercent: numbers.gstPercent,
      noBypassMonths: numbers.noBypassMonths,
      noBypassPenaltyPercent: numbers.noBypassPenaltyPercent,
    }, policy);
    const termsHtml = rendered.html;
    const termsHash = rendered.hash;
    const now = this.clock.now();
    const sendsSms = options.sms !== false;
    if (sendsSms) await this.assertAgreementLinkAllowed(business.id, now);
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const { token, id: linkId } = await this.publicLinks.create({
      purpose: 'business_agreement', subjectType: 'business', subjectId: business.id,
      phone: business.phone, language, createdByStaffId: staffId ?? undefined, expiresAt,
      metadata: { ...(options.issuedTo ? { issuedTo: options.issuedTo } : {}), agreement: {
        ...numbers,
        version: rendered.version,
        language: agreementLanguage,
        termsHtml,
        termsHash,
        summaryHtml: rendered.summaryHtml,
        bodyHtml: rendered.bodyHtml,
      } },
    });

    // Rev 188: the answer says whether the SMS went, so no screen has to swallow a failure.
    const sentBy = !sendsSms ? null : await this.sendLinkMessage(options.channel, {
      template: 'agreement_link',
      subjectType: 'business',
      subjectId: business.id,
      variables: { token, link: publicPageLink('businessAgreement', token) },
    });
    // smsSent keeps its name for the screens: "the link reached the owner" (by SMS or WhatsApp).
    const smsSent = sendsSms ? sentBy !== null : null;
    if (smsSent === false) {
      // Nothing reached the owner (staff never get the token): the link is withdrawn, so it
      // never counts towards the limit and the previous link stays the live one.
      await this.prisma.publicLink.updateMany({ where: { id: linkId, usedAt: null }, data: { revokedAt: now } });
    }
    return { success: true, token, expiresAt, linkId, smsSent, sentBy };
  }

  /** The business's agreement links that count towards the limit (newest first). */
  async recentAgreementLinks(businessId: string, now: Date): Promise<Date[]> {
    const rows = await this.prisma.publicLink.findMany({
      where: {
        purpose: 'business_agreement',
        subjectType: 'business',
        subjectId: businessId,
        revokedAt: null,
        createdAt: { gt: new Date(now.getTime() - AGREEMENT_LINK_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return rows.map((r) => r.createdAt);
  }

  /** Rev 192 fix S2: the shared per-business limit, checked before any agreement link is sent by SMS. */
  async assertAgreementLinkAllowed(businessId: string, now: Date = this.clock.now()): Promise<void> {
    const window = agreementLinkWindow(await this.recentAgreementLinks(businessId, now), now);
    if (window.allowedNow) return;
    throw codedError(
      HttpStatus.TOO_MANY_REQUESTS,
      window.limit === 'gap' ? 'AGREEMENT_RESEND_TOO_SOON' : 'AGREEMENT_RESEND_LIMIT',
      window.limit === 'gap'
        ? 'A link was just sent. Wait a minute before sending another.'
        : `At most ${AGREEMENT_LINK_MAX_PER_DAY} agreement links a day for one business.`,
      { retryAt: window.retryAt?.toISOString() ?? null },
    );
  }

  /** The referral partner terms link, in English (rev 193; a language an older client sends is ignored). */
  async createReferralTermsLink(referralId: string, staffId: string | null, _requestedLanguage?: string, options: { sms?: boolean; issuedTo?: string; revokeOthers?: boolean; channel?: LinkSendChannel } = {}) {
    const language = productLanguage(_requestedLanguage);
    const referral = await this.prisma.referral.findUnique({ where: { id: referralId } });
    if (!referral) throw new NotFoundException(`Referral '${referralId}' not found`);

    const policy = await this.pricingService.current();
    const referralPayoutPaise = policy.referralPayoutPaise;
    const agreementLanguage: AgreementLanguage = language;
    // Referral Partner Terms v1.0, the full text (rev 176), with today's reward.
    const rendered = await this.legal.render('referral_terms', agreementLanguage, { referralPayoutPaise }, policy);
    const termsHtml = rendered.html;
    const termsHash = rendered.hash;
    const now = this.clock.now();
    if (options.revokeOthers !== false) await this.publicLinks.revokeActive('referral_registration', 'referral', referral.id, now);
    const expiresAt = new Date(now.getTime() + (await this.registrationTtl(false)));
    const { token } = await this.publicLinks.create({
      purpose: 'referral_registration', subjectType: 'referral', subjectId: referral.id,
      phone: referral.phone, language, createdByStaffId: staffId ?? undefined, expiresAt,
      metadata: { partnerName: referral.name, ownerName: referral.name, resumable: true, ...(options.issuedTo ? { issuedTo: options.issuedTo } : {}), terms: {
        referralPayoutPaise,
        version: rendered.version,
        language: agreementLanguage,
        termsHtml,
        termsHash,
        summaryHtml: rendered.summaryHtml,
        bodyHtml: rendered.bodyHtml,
      } },
    });

    const sentBy = options.sms === false ? null : await this.sendLinkMessage(options.channel, {
      template: 'referral_terms_link',
      subjectType: 'referral',
      subjectId: referral.id,
      // The one link that resumes (P-Partner…): terms and call-recording consent → selfie → ID check → UPI.
      variables: { token, link: publicPageLink('referralRegistration', token), referralCode: referral.code },
    });

    return { success: true, token, expiresAt, sentBy };
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

  /**
   * Which new public page an old /consent/:token link opens in a browser:
   * the registration link (P00…), the business agreement (P04) or the
   * referral partner's link (P-Partner…).
   */
  async publicPageForToken(token: string): Promise<PublicPage | null> {
    let row: { purpose: string } | null;
    try {
      row = await this.prisma.publicLink.findUnique({
        where: { tokenHash: this.publicLinks.hashToken(token) },
        select: { purpose: true },
      });
    } catch {
      return null; // can't tell: keep the old behaviour for this request
    }
    if (!row) return 'registration';
    if (row.purpose === 'registration') return 'registration';
    if (row.purpose === 'business_agreement') return 'businessAgreement';
    if (row.purpose === 'referral_registration') return 'referralRegistration';
    return null;
  }

  /**
   * After the owner signs, the agreement link is used up. For the rest of its
   * life it still shows that it was signed (P04b) and gives the signed copy.
   */
  async signedAgreementForLink(token: string) {
    const row = await this.prisma.publicLink.findUnique({ where: { tokenHash: this.publicLinks.hashToken(token) } });
    if (!row || row.purpose !== 'business_agreement' || row.revokedAt || !row.usedAt) {
      throw new NotFoundException('No signed agreement for this link');
    }
    if (row.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('Consent link has expired');
    }
    const documentStoragePath = `business-agreements/${row.subjectId}/${row.tokenHash}.html`;
    const [agreement, business] = await Promise.all([
      this.prisma.businessAgreement.findFirst({
        where: { businessId: row.subjectId, documentStoragePath },
        select: { signedAt: true, signedName: true, documentStoragePath: true },
      }),
      this.prisma.business.findUnique({ where: { id: row.subjectId }, select: { name: true } }),
    ]);
    if (!agreement || !business) throw new NotFoundException('No signed agreement for this link');
    const metadata = (row.metadata ?? {}) as { agreement?: { language?: string } };
    return {
      signedAt: agreement.signedAt,
      signedName: agreement.signedName,
      businessName: business.name,
      preferredLanguage: metadata.agreement?.language ?? row.language ?? 'en',
      documentStoragePath: agreement.documentStoragePath,
    };
  }

  async signedAgreementDocumentForLink(token: string) {
    const signed = await this.signedAgreementForLink(token);
    const body = await this.agreementStorage.get(signed.documentStoragePath);
    if (!body) throw new NotFoundException('The signed agreement document is unavailable');
    return { body, businessName: signed.businessName };
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
    const metadata = (row.metadata ?? {}) as unknown as Record<string, unknown>;
    const base = {
      token, expiresAt: row.expiresAt, usedAt: row.usedAt, createdAt: row.createdAt,
      issuedTo: typeof metadata.issuedTo === 'string' ? metadata.issuedTo : null,
    };
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
    // A link is bound to the number it was sent to: one without a phone opens nothing.
    if ((row.purpose === 'business_agreement' || row.purpose === 'referral_registration') && !row.phone) {
      throw new BadRequestException('Invalid link token');
    }
    if (row.purpose === 'business_agreement') {
      return { ...base, subjectType: 'business', subjectId: row.subjectId, businessId: row.subjectId,
        businessPhone: row.phone!, createdByStaffId: row.createdByStaffId ?? '',
        agreement: metadata.agreement as Extract<ConsentLinkTokenRecord, { subjectType: 'business' }>['agreement'] };
    }
    if (row.purpose === 'referral_registration') {
      return { ...base, subjectType: 'referral', subjectId: row.subjectId, referralId: row.subjectId,
        partnerPhone: row.phone!, partnerName: String(metadata.partnerName ?? ''),
        createdByStaffId: row.createdByStaffId ?? '',
        terms: metadata.terms as Extract<ConsentLinkTokenRecord, { subjectType: 'referral' }>['terms'] };
    }
    if (row.purpose === 'registration') {
      return {
        ...base,
        subjectType: 'job_seeker',
        subjectId: row.subjectId,
        jobSeekerId: row.subjectId,
        resumable: metadata.resumable === true,
      };
    }
    throw new BadRequestException('Invalid consent link token');
  }

  async getTokenDetails(token: string, requestId?: string): Promise<ConsentLinkDetails> {
    const record = await this.validateToken(token);
    if (record.subjectType === 'interview') {
      throw new BadRequestException('This token is not a consent or agreement link');
    }
    if (record.subjectType === 'business') {
      const business = await this.prisma.business.findUnique({ where: { id: record.businessId } });
      if (!business) throw new NotFoundException('Business not found');
      const policy = await this.pricingService.current();
      const previous = await this.prisma.businessAgreement.findFirst({
        where: { businessId: business.id }, orderBy: { signedAt: 'desc' }, select: { version: true },
      });
      return {
        valid: true,
        subjectType: 'business',
        businessId: business.id,
        businessName: business.name,
        maskedPhone: maskAgreementPhone(record.businessPhone),
        preferredLanguage: record.agreement.language,
        agreementTermsHtml: record.agreement.termsHtml,
        agreementSummaryHtml: record.agreement.summaryHtml ?? null,
        agreementBodyHtml: record.agreement.bodyHtml ?? null,
        version: record.agreement.version,
        previousVersion: previous?.version ?? null,
        ownerName: business.ownerName ?? null,
        terms: {
          feePercent: record.agreement.feePercent,
          gstPercent: record.agreement.gstPercent,
          noBypassMonths: record.agreement.noBypassMonths,
          noBypassPenaltyPercent: record.agreement.noBypassPenaltyPercent,
        },
        guarantee: {
          replacementWindowDays: policy.replacementWindowDays,
          maxFreeReplacements: policy.maxFreeReplacements,
          replacementSearchDays: policy.replacementSearchDays,
        },
      };
    }

    if (record.subjectType === 'referral') {
      // As for job seekers: nothing about the partner (name, ID, terms, amount)
      // until a code sent to their own number is verified.
      if (!(await this.otpService.isVerifiedForPage(requestId, record.partnerPhone, token))) {
        return {
          valid: true,
          subjectType: 'referral',
          otpRequired: true,
          maskedPhone: maskAgreementPhone(record.partnerPhone),
          preferredLanguage: record.terms.language,
        };
      }
      const referral = await this.prisma.referral.findUnique({ where: { id: record.referralId } });
      if (!referral) throw new NotFoundException('Referral partner not found');
      return {
        valid: true,
        subjectType: 'referral',
        otpRequired: false,
        referralId: referral.id,
        partnerName: referral.name,
        maskedPhone: maskAgreementPhone(record.partnerPhone),
        preferredLanguage: record.terms.language,
        termsHtml: record.terms.termsHtml,
        summaryHtml: record.terms.summaryHtml ?? null,
        bodyHtml: record.terms.bodyHtml ?? null,
        version: record.terms.version,
        referralPayoutPaise: record.terms.referralPayoutPaise,
        reconsent: await this.reconsentFor('referral', referral.id),
      };
    }

    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: record.jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException('Job seeker not found');
    }

    // English only (rev 193): the page and the terms are in English.
    const preferredLanguage = PRODUCT_LANGUAGE;
    if (!(await this.otpService.isVerifiedForPage(requestId, seeker.phone, token))) {
      return {
        valid: true,
        subjectType: 'job_seeker',
        otpRequired: true,
        maskedPhone: maskAgreementPhone(seeker.phone),
        preferredLanguage,
      };
    }
    const [consents, verification, payment] = await Promise.all([
      this.prisma.consent.findMany({
        where: { subjectType: 'job_seeker', subjectId: seeker.id, granted: true, withdrawnAt: null },
        select: { purpose: true },
      }),
      this.prisma.identityVerification.findFirst({
        where: { jobSeekerId: seeker.id },
        orderBy: { createdAt: 'desc' },
        select: { status: true, nameMatches: true, isAdult: true },
      }),
      this.prisma.payment.findFirst({
        where: { jobSeekerId: seeker.id, type: 'activation', status: { in: ['succeeded', 'completed'] } },
        select: { id: true },
      }),
    ]);
    const hasAllConsent = JOB_SEEKER_REQUIRED_CONSENT_PURPOSES.every((purpose) =>
      consents.some((consent) => consent.purpose === purpose),
    );
    const currentStep = !hasAllConsent
      ? 'consent'
      : !seeker.photoStoragePath
        ? 'selfie'
        : !verification || verification.status !== 'verified' || verification.nameMatches === false || verification.isAdult === false
          ? 'id_check'
          : !payment
            ? 'payment'
            : 'complete';

    return {
      valid: true,
      subjectType: 'job_seeker',
      jobSeekerId: seeker.id,
      candidateName: '',
      phone: maskAgreementPhone(seeker.phone),
      preferredLanguage,
      currentStep,
      otpRequired: false,
      reconsent: currentStep === 'consent' ? null : await this.reconsentFor('job_seeker', seeker.id),
    };
  }

  /** The re-consent check, or null when the current version is accepted. */
  private async reconsentFor(subjectType: 'job_seeker' | 'referral', subjectId: string): Promise<LegalStatus | null> {
    const status = await this.legal.status(subjectType, subjectId);
    return status.needsReconsent ? status : null;
  }

  async sendOtp(token: string) {
    const record = await this.validateToken(token);
    let phone: string;
    if (record.subjectType === 'interview') {
      if (record.purpose !== 'owner_result') {
        throw new BadRequestException('This interview link does not require OTP');
      }
      phone = record.phone;
    } else if (record.subjectType === 'business') {
      phone = record.businessPhone;
    } else if (record.subjectType === 'referral') {
      phone = record.partnerPhone;
    } else {
      const seeker = await this.prisma.jobSeeker.findUnique({
        where: { id: record.jobSeekerId },
      });
      if (!seeker) {
        throw new NotFoundException('Job seeker not found');
      }
      phone = seeker.phone;
    }
    // Every public "Send code" costs an SMS: limited per link and per phone on the server.
    await this.otpLimiter.claimSend(this.publicLinks.hashToken(token), phone, this.clock.now());
    // AC-3: a code bound to this link; staff-sent codes are never accepted on it.
    const otp = await this.otpService.sendPublicPageOtp(phone, token);
    return { success: true, requestId: otp.requestId, phone: maskAgreementPhone(phone), ...testModeFields(otp) };
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

    if (record.resumable && await this.consentService.hasAllRequired('job_seeker', seeker.id)) {
      throw new BadRequestException('Consent link has already been used');
    }

    // Verify OTP: either through otpCode or if already verified — always a code sent to his own phone.
    // AC-3: only a code sent from this link's own page counts (never one an agent asked for).
    if (dto.otpCode) {
      const ok = await this.otpService.verifyOtp(dto.otpRequestId, dto.otpCode);
      if (!ok || !(await this.otpService.isVerifiedForPage(dto.otpRequestId, seeker.phone, record.token))) {
        throw new BadRequestException('Invalid or expired OTP');
      }
    } else {
      const verified = await this.otpService.isVerifiedForPage(dto.otpRequestId, seeker.phone, record.token);
      if (!verified) {
        throw new BadRequestException('OTP verification is required before submission');
      }
    }

    // English only (rev 193): what he accepted is the English text, whatever an older page sends.
    const language = productLanguage(dto.language);
    const purposes = Array.isArray(dto.purposes) ? dto.purposes : [];
    const legalLanguage: AgreementLanguage = language;
    const rendered = await this.legal.render('job_seeker_terms', legalLanguage);
    // The exact text he read: the page sends the hash of the terms it showed (required).
    if (!dto.textHash) throw new BadRequestException('textHash is required: send the hash of the terms text the page showed');
    if (dto.textHash !== rendered.hash) throw new BadRequestException(TERMS_TEXT_CHANGED_MESSAGE);
    // A one-time link is finished by this submit, so its code is used up here. A resumable
    // registration link keeps the page's code for the next steps (selfie, ID, terms) until
    // it expires, 5 minutes after it was sent.
    if (!record.resumable && !(await this.otpService.consumeVerifiedForPage(dto.otpRequestId, seeker.phone, record.token))) {
      throw new BadRequestException('This code has already been used. Ask for a new code.');
    }

    // Grant each selected purpose: one already given (and not withdrawn) is not stored again (17 Nov).
    for (const purpose of purposes) {
      await this.consentService.grant({
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose,
        noticeVersion: DEFAULT_NOTICE_VERSION,
        language,
        method: consentMethodFor(record),
        otpRequestId: dto.otpRequestId,
      });
    }

    // Mark token as used
    if (!record.resumable) await this.publicLinks.markUsed(record.token, this.clock.now());

    // Move a lead forward after first consent, or reactivate a paused seeker once all required purposes are restored.
    const hasAll = await this.consentService.hasAllRequired('job_seeker', seeker.id);
    if (hasAll) {
      // The terms and notice version, language, OTP and exact text he accepted (P01, rev 176), with every
      // item he has given under THIS notice version — also those given earlier and not asked again on this
      // page (17 Nov). An item given only under an older notice is not listed: the page asks it again.
      const given = await this.prisma.consent.findMany({
        where: { subjectType: 'job_seeker', subjectId: seeker.id, noticeVersion: DEFAULT_NOTICE_VERSION, granted: true, grantedAt: { not: null }, withdrawnAt: null },
        select: { purpose: true },
      });
      const allGiven = JOB_SEEKER_CONSENT_PURPOSES.filter((p) => purposes.includes(p) || given.some((g) => g.purpose === p));
      await this.legal.recordAcceptance({
        subjectType: 'job_seeker', subjectId: seeker.id,
        rendered,
        context: 'registration', method: consentMethodFor(record), otpRequestId: dto.otpRequestId,
        noticeVersion: DEFAULT_NOTICE_VERSION, purposes: allGiven, acceptedAt: this.clock.now(),
      });
    }
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
    // Business agreement v1.1, "Signing by OTP": three ticks — terms, authority, call recording.
    // agreement_terms and call_recording are consent purposes; the authority tick is kept on the acceptance.
    const requiredPurposes = ['agreement_terms', 'call_recording'];
    const signedTicks = ['agreement_terms', 'agreement_authority', 'call_recording'];
    const purposes = Array.isArray(dto.purposes) ? dto.purposes : [];
    if (purposes.length !== signedTicks.length || signedTicks.some((purpose) => !purposes.includes(purpose))) {
      throw new BadRequestException('Agreement terms, authority to sign and call recording consent are all required');
    }
    const signedName = dto.signedName?.trim();
    if (!signedName) throw new BadRequestException('signedName is required');
    const otpValid = dto.otpCode
      ? await this.otpService.verifyOtp(dto.otpRequestId, dto.otpCode)
      : false;
    // AC-3: a code sent from this link's page, used up by the signature (one per agreement).
    const otpBelongsToOwner = otpValid
      ? await this.otpService.consumeVerifiedForPage(dto.otpRequestId, record.businessPhone, record.token)
      : false;
    if (!otpBelongsToOwner) {
      throw new BadRequestException('Valid owner OTP is required to sign the agreement');
    }
    const business = await this.prisma.business.findUnique({ where: { id: record.businessId } });
    if (!business) throw new NotFoundException('Business not found');

    const documentStoragePath = `business-agreements/${record.businessId}/${this.publicLinks.hashToken(record.token)}.html`;
    // The terms on the link are exactly the ones shown (hash frozen when the link was sent).
    const shownHash = createHash('sha256').update(record.agreement.termsHtml, 'utf8').digest('hex');
    if (shownHash !== record.agreement.termsHash) {
      throw new BadRequestException('Agreement document does not match the shown terms');
    }
    const signedAt = this.clock.now();
    const previous = await this.prisma.businessAgreement.findFirst({ where: { businessId: business.id }, orderBy: { signedAt: 'desc' }, select: { id: true } });
    const onboardedBy = record.createdByStaffId
      ? (await this.prisma.staff.findUnique({ where: { id: record.createdByStaffId }, select: { code: true } }).catch(() => null))?.code ?? null
      : null;
    // The stored signed copy: the FULL agreement text the owner accepted, then the acceptance record.
    const document = renderSignedAgreementDocument(record.agreement.termsHtml, {
      businessName: business.legalName || business.name,
      businessCode: business.code,
      signedName,
      signedRole: business.contactRole ?? 'owner',
      maskedPhone: maskAgreementPhone(record.businessPhone),
      otpRequestId: dto.otpRequestId,
      signedAtIst: formatIstDateTime(signedAt),
      version: record.agreement.version,
      language: record.agreement.language,
      ticks: signedTicks,
      onboardedBy,
      billingEmail: business.billingEmail ?? null,
    });
    const documentBytes = Buffer.from(document, 'utf8');
    await this.agreementStorage.put(documentStoragePath, documentBytes, 'text/html; charset=utf-8');

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
          signedRole: business.contactRole ?? 'owner',
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
            method: consentMethodFor(record),
            otpRequestId: dto.otpRequestId,
          },
          tx,
        );
      }
      await this.legal.recordAcceptance({
        subjectType: 'business', subjectId: business.id,
        rendered: { hash: record.agreement.termsHash, key: 'business_agreement', version: record.agreement.version, language: record.agreement.language, html: record.agreement.termsHtml },
        context: previous ? 'reconsent' : 'agreement', method: consentMethodFor(record), otpRequestId: dto.otpRequestId,
        purposes: signedTicks, acceptedAt: signedAt,
      }, tx);
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
        signedRole: agreement.signedRole,
      },
      changedFields: ['version', 'termsHash', 'otpRequestId', 'signedAt', 'signedRole'],
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
    // Referral Partner Terms v1.0, "Your consent": terms, call recording and (S2) the separate ID-check consent.
    const requiredPurposes = ['agreement_terms', 'call_recording', 'aadhaar_verification'];
    const purposes = Array.isArray(dto.purposes) ? dto.purposes : [];
    if (
      purposes.length !== requiredPurposes.length ||
      requiredPurposes.some((p) => !purposes.includes(p))
    ) {
      throw new BadRequestException('The terms, call recording consent and ID-check consent are all required');
    }

    // A fresh code, or (as on the job seeker's link) the code the partner verified
    // when opening this resumable link, still within its lifetime.
    const otpValid = dto.otpCode
      ? await this.otpService.verifyOtp(dto.otpRequestId, dto.otpCode)
      : Boolean(dto.otpRequestId);
    // AC-3: a code sent from this link's own page. The partner's link is resumable (ID check
    // and payout details follow), so the code is used up when the payout details are saved.
    const otpBelongsToPartner = otpValid
      ? await this.otpService.isVerifiedForPage(dto.otpRequestId, record.partnerPhone, record.token)
      : false;
    if (!otpBelongsToPartner) {
      throw new BadRequestException('Valid owner OTP is required to sign referral terms');
    }

    const referral = await this.prisma.referral.findUnique({ where: { id: record.referralId } });
    if (!referral) throw new NotFoundException('Referral partner not found');

    const signedAt = this.clock.now();
    const previousAcceptance = await this.legal.status('referral', referral.id);
    await this.prisma.$transaction(async (tx) => {
      // The signed copy: the exact terms text shown on this link, with version, language and OTP.
      await this.legal.recordAcceptance({
        subjectType: 'referral', subjectId: referral.id,
        rendered: { hash: record.terms.termsHash, key: 'referral_terms', version: record.terms.version, language: record.terms.language, html: record.terms.termsHtml },
        context: previousAcceptance.needsReconsent ? 'reconsent' : 'partner_terms', method: consentMethodFor(record), otpRequestId: dto.otpRequestId,
        purposes: requiredPurposes, acceptedAt: signedAt,
      }, tx);
      for (const purpose of requiredPurposes) {
        await this.consentService.grant(
          {
            subjectType: 'referral',
            subjectId: referral.id,
            purpose,
            noticeVersion: record.terms.version,
            language: record.terms.language,
            method: consentMethodFor(record),
            otpRequestId: dto.otpRequestId,
          },
          tx,
        );
      }
    });

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

  /**
   * Re-consent (rev 176): someone who accepted an older version opens their
   * link and accepts the current one — "In short", "Read the full terms",
   * the itemised ticks and the OTP they verified on opening the link. The
   * acceptance is recorded with version, language, OTP and the exact text. A
   * running job seeker guarantee keeps the terms version it was paid under
   * (JobSeeker.termsAcceptedVersion is not touched; terms 18.2).
   */
  async submitReconsent(dto: SubmitConsentDto) {
    const record = await this.validateToken(dto.token);
    if (record.subjectType !== 'job_seeker' && record.subjectType !== 'referral') {
      throw new BadRequestException('Re-consent is on the job seeker\'s or the partner\'s link (a business signs the new agreement on P04)');
    }
    const phone = record.subjectType === 'referral'
      ? record.partnerPhone
      : (await this.prisma.jobSeeker.findUnique({ where: { id: record.jobSeekerId }, select: { phone: true } }))?.phone;
    if (!phone) throw new NotFoundException('Not found');
    // AC-3: a code sent from this link's own page (never a staff-sent one).
    const otpOk = dto.otpCode
      ? (await this.otpService.verifyOtp(dto.otpRequestId, dto.otpCode)) && (await this.otpService.isVerifiedForPage(dto.otpRequestId, phone, record.token))
      : await this.otpService.isVerifiedForPage(dto.otpRequestId, phone, record.token);
    if (!otpOk) throw new BadRequestException('OTP verification is required before submission');
    const language: AgreementLanguage = productLanguage(dto.language);
    const subjectId = record.subjectType === 'referral' ? record.referralId : record.jobSeekerId;
    return this.recordReconsent(record.subjectType, subjectId, {
      purposes: Array.isArray(dto.purposes) ? dto.purposes : [],
      language,
      method: consentMethodFor(record),
      otpRequestId: dto.otpRequestId,
      textHash: dto.textHash,
    });
  }

  /**
   * Shared by the link (above) and the customer app (OTP proved by its step-up).
   * Only for someone who did the first consent step and must now accept the
   * current version: it never grants the consents from nothing.
   */
  async recordReconsent(
    subjectType: 'job_seeker' | 'referral',
    subjectId: string,
    input: { purposes: string[]; language: AgreementLanguage; method: string; otpRequestId: string | null; textHash?: string | null },
  ) {
    const required = subjectType === 'job_seeker' ? [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES] : ['agreement_terms', 'call_recording', 'aadhaar_verification'];
    const allowed = subjectType === 'job_seeker' ? [...required, 'promotions'] : required;
    const purposes = [...new Set(input.purposes)];
    if (required.some((p) => !purposes.includes(p)) || purposes.some((p) => !allowed.includes(p))) {
      throw new BadRequestException('Tick every required permission to accept the updated terms');
    }
    const status = await this.legal.status(subjectType, subjectId);
    if (!status.needsReconsent) {
      // Already on the current version (a second tap): nothing to record.
      if (status.acceptedVersion === status.currentVersion) return { success: true, version: status.currentVersion, acceptedAt: status.acceptedAt, alreadyAccepted: true };
      throw new BadRequestException('Give your consent on the first step of your registration link first');
    }
    const key = subjectType === 'job_seeker' ? 'job_seeker_terms' : 'referral_terms';
    const rendered = await this.legal.render(key, input.language);
    if (!input.textHash) throw new BadRequestException('textHash is required: send the hash of the terms text the page showed');
    if (input.textHash !== rendered.hash) throw new BadRequestException(TERMS_TEXT_CHANGED_MESSAGE);
    const noticeVersion = subjectType === 'job_seeker' ? DEFAULT_NOTICE_VERSION : rendered.version;
    const acceptedAt = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      for (const purpose of purposes) {
        await this.consentService.grant({
          subjectType, subjectId, purpose, noticeVersion, language: input.language, method: input.method, otpRequestId: input.otpRequestId,
        }, tx);
      }
      // Promotions left unticked on the new version: an earlier "yes" to promotions is withdrawn.
      if (subjectType === 'job_seeker' && !purposes.includes('promotions')) {
        await tx.consent.updateMany({
          where: { subjectType, subjectId, purpose: 'promotions', granted: true, withdrawnAt: null },
          data: { granted: false, withdrawnAt: acceptedAt, withdrawnMethod: input.method },
        });
      }
      await this.legal.recordAcceptance({
        subjectType, subjectId, rendered, context: 'reconsent', method: input.method, otpRequestId: input.otpRequestId,
        noticeVersion: subjectType === 'job_seeker' ? DEFAULT_NOTICE_VERSION : null, purposes, acceptedAt,
      }, tx);
    });
    await this.auditService.log({
      actorId: 'system',
      action: 'legal.reconsent_accepted',
      entityType: subjectType,
      entityCode: subjectId,
      before: { version: status.acceptedVersion, noticeVersion: status.noticeVersion },
      after: { version: rendered.version, noticeVersion: subjectType === 'job_seeker' ? DEFAULT_NOTICE_VERSION : null, language: input.language, textHash: rendered.hash, otpRequestId: input.otpRequestId },
      changedFields: ['legalAcceptance'],
      reason: 'Accepted the updated terms by OTP',
    });
    return { success: true, version: rendered.version, acceptedAt };
  }
}
