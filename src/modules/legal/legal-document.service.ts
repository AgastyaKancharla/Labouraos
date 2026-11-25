import { Injectable } from '@nestjs/common';
import { Prisma, PricingPolicy } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { CONSENT_NOTICES, GUARANTEE_START_NOTICE } from '../consent/consent-notices';
import {
  DEFAULT_NOTICE_VERSION,
  JOB_SEEKER_CONSENT_PURPOSES,
  JOB_SEEKER_REQUIRED_CONSENT_PURPOSES,
} from '../consent/consent.constants';
import {
  grievanceContact,
  LEGAL_DOCUMENT_VERSIONS,
  LegalCompanyDetails,
  LegalDocumentKey,
  LegalNumbers,
  renderLegalDocument,
  RenderedLegalDocument,
} from './legal-documents';
import { LegalLanguage } from './legal-document.types';
import { legalStatusOf, LegalStatus, LegalSubjectType } from './legal-status';

type Client = PrismaService | Prisma.TransactionClient;
export type { LegalStatus, LegalSubjectType } from './legal-status';

export type AcceptedText = Pick<RenderedLegalDocument, 'hash' | 'key' | 'version' | 'language' | 'html'>;

export interface RecordAcceptanceInput {
  subjectType: LegalSubjectType;
  subjectId: string;
  rendered: AcceptedText;
  context: 'registration' | 'payment_terms' | 'agreement' | 'partner_terms' | 'reconsent';
  method: string;
  otpRequestId?: string | null;
  noticeVersion?: string | null;
  purposes?: string[];
  acceptedAt: Date;
}


export function legalNumbersFrom(policy: PricingPolicy): LegalNumbers {
  return {
    activationFeePaise: policy.activationFeePaise,
    jobSeekerGuaranteeDays: policy.jobSeekerGuaranteeDays,
    offerReplyHours: policy.offerReplyHours,
    maxHits: policy.maxHits,
    joiningRewardPaise: policy.joiningRewardPaise,
    joiningRewardAfterDays: policy.joiningRewardAfterDays,
    registrationLinkValidHours: policy.registrationLinkValidHours,
    paymentOnlyLinkMinutes: policy.paymentOnlyLinkMinutes,
    placementFeePercent: policy.placementFeePercent,
    gstPercent: policy.gstPercent,
    placementPaymentDueHours: policy.placementPaymentDueHours,
    interviewResultEscalateHours: policy.interviewResultEscalateHours,
    replacementWindowDays: policy.replacementWindowDays,
    maxFreeReplacements: policy.maxFreeReplacements,
    maxReplacementRejections: policy.maxReplacementRejections,
    replacementSearchDays: policy.replacementSearchDays,
    claimReportDays: policy.claimReportDays,
    claimDecisionHours: policy.claimDecisionHours,
    noBypassMonths: policy.noBypassMonths,
    noBypassPenaltyPercent: policy.noBypassPenaltyPercent,
    referralPayoutPaise: policy.referralPayoutPaise,
    payoutDetailsCoolingHours: policy.payoutDetailsCoolingHours,
  };
}

export function legalCompanyFrom(policy: Pick<PricingPolicy, 'companyLegalName' | 'companyGstin' | 'companyAddress'> & Partial<PricingPolicy>): LegalCompanyDetails {
  return {
    legalName: policy.companyLegalName?.trim() || 'Laboura Private Limited',
    cin: policy.companyCin ?? null,
    registeredOffice: policy.companyAddress ?? null,
    gstin: policy.companyGstin ?? null,
    grievanceOfficerName: policy.grievanceOfficerName ?? null,
    grievanceOfficerPhone: policy.grievanceOfficerPhone ?? null,
    grievanceOfficerEmail: policy.grievanceOfficerEmail ?? null,
  };
}

/**
 * The legal documents as the software shows them (Master Guide rev 176):
 * rendered from the versioned content with today's Settings, recorded with
 * the exact text each time someone accepts, and the check for who must
 * accept a newer version.
 */
@Injectable()
export class LegalDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async company(): Promise<LegalCompanyDetails> {
    return legalCompanyFrom(await this.pricing.current());
  }

  /** The public company block: every public page footer and the app's Privacy screen. */
  async publicCompany(language: LegalLanguage = 'en') {
    const company = await this.company();
    return {
      legalName: company.legalName,
      cin: company.cin,
      registeredOffice: company.registeredOffice,
      gstin: company.gstin,
      grievanceOfficer: {
        name: company.grievanceOfficerName,
        phone: company.grievanceOfficerPhone,
        email: company.grievanceOfficerEmail,
      },
      grievanceContact: grievanceContact(company, language),
      versions: LEGAL_DOCUMENT_VERSIONS,
      noticeVersion: DEFAULT_NOTICE_VERSION,
    };
  }

  /**
   * Renders a document. `numbers` can carry figures frozen earlier (the
   * business agreement keeps the fee and no-bypass numbers of the day its
   * link was sent); everything else comes from today's Settings. A caller
   * that has already read Settings passes that policy, so one link is built
   * from one reading of Settings.
   */
  async render(
    key: LegalDocumentKey,
    language: LegalLanguage,
    numbers: Partial<LegalNumbers> = {},
    policyRead?: Parameters<typeof legalNumbersFrom>[0] & Parameters<typeof legalCompanyFrom>[0],
  ): Promise<RenderedLegalDocument> {
    const policy = policyRead ?? (await this.pricing.current());
    return renderLegalDocument(key, language, { ...legalNumbersFrom(policy), ...numbers }, legalCompanyFrom(policy));
  }

  /** The document plus, for job seekers and partners, the itemised ticks (consent-notices.ts). */
  async publicDocument(key: LegalDocumentKey, language: LegalLanguage) {
    const rendered = await this.render(key, language);
    return {
      key: rendered.key,
      version: rendered.version,
      language: rendered.language,
      title: rendered.title,
      summary: rendered.summary,
      summaryHtml: rendered.summaryHtml,
      bodyHtml: rendered.bodyHtml,
      hash: rendered.hash,
      noticeVersion: key === 'job_seeker_terms' ? DEFAULT_NOTICE_VERSION : null,
      /** Notice 1.3 (rev 211): the line shown above the job seeker's ticks, word for word. */
      consentNotice: key === 'job_seeker_terms' ? GUARANTEE_START_NOTICE : null,
      consents: consentTicks(key, language),
    };
  }

  /** Stores the exact text (once per hash) and the acceptance. */
  async recordAcceptance(input: RecordAcceptanceInput, client: Client = this.prisma) {
    const { rendered } = input;
    await client.legalDocumentText.upsert({
      where: { hash: rendered.hash },
      create: { hash: rendered.hash, documentKey: rendered.key, version: rendered.version, language: rendered.language, html: rendered.html },
      update: {},
    });
    return client.legalAcceptance.create({
      data: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        documentKey: rendered.key,
        version: rendered.version,
        language: rendered.language,
        textHash: rendered.hash,
        context: input.context,
        method: input.method,
        otpRequestId: input.otpRequestId ?? null,
        noticeVersion: input.noticeVersion ?? null,
        purposes: input.purposes ?? [],
        acceptedAt: input.acceptedAt,
      },
    });
  }

  /** Stores a signed copy's exact HTML (the business agreement keeps its own copy too). */
  async storeText(rendered: AcceptedText, client: Client = this.prisma) {
    await client.legalDocumentText.upsert({
      where: { hash: rendered.hash },
      create: { hash: rendered.hash, documentKey: rendered.key, version: rendered.version, language: rendered.language, html: rendered.html },
      update: {},
    });
  }

  async acceptances(subjectType: LegalSubjectType, subjectId: string) {
    return this.prisma.legalAcceptance.findMany({
      where: { subjectType, subjectId },
      orderBy: { acceptedAt: 'desc' },
      select: { id: true, documentKey: true, version: true, language: true, context: true, method: true, otpRequestId: true, noticeVersion: true, purposes: true, acceptedAt: true, textHash: true },
    });
  }

  async acceptanceText(id: string): Promise<string | null> {
    const row = await this.prisma.legalAcceptance.findUnique({ where: { id }, select: { text: { select: { html: true } } } });
    return row?.text.html ?? null;
  }

  /** Has this person accepted the current version? (legal-status.ts) */
  status(subjectType: LegalSubjectType, subjectId: string): Promise<LegalStatus> {
    return legalStatusOf(this.prisma, subjectType, subjectId);
  }
}

/** The ticks a document asks for, in the person's language, from consent-notices.ts. */
export function consentTicks(key: LegalDocumentKey, language: LegalLanguage) {
  const purposes: { purpose: string; required: boolean }[] =
    key === 'job_seeker_terms'
      ? JOB_SEEKER_CONSENT_PURPOSES.map((purpose) => ({ purpose, required: (JOB_SEEKER_REQUIRED_CONSENT_PURPOSES as readonly string[]).includes(purpose) }))
      : key === 'referral_terms'
        ? [
            { purpose: 'agreement_terms', required: true },
            { purpose: 'call_recording', required: true },
            { purpose: 'aadhaar_verification', required: true },
          ]
        : [
            { purpose: 'agreement_terms', required: true },
            { purpose: 'agreement_authority', required: true },
            { purpose: 'call_recording', required: true },
          ];
  const notices = key === 'job_seeker_terms' ? CONSENT_NOTICES : key === 'referral_terms' ? REFERRAL_CONSENT_NOTICES : BUSINESS_CONSENT_NOTICES;
  return purposes.map((p) => ({ ...p, title: notices[p.purpose][language].title, description: notices[p.purpose][language].description, withdrawal: notices[p.purpose][language].withdrawal ?? null }));
}

type Notice = Record<LegalLanguage, { title: string; description: string; withdrawal?: string }>;

/** Referral Partner Terms v1.0, "Your consent". */
export const REFERRAL_CONSENT_NOTICES: Record<string, Notice> = {
  agreement_terms: {
    en: { title: 'Referral Partner Terms', description: 'I agree to these Referral Partner Terms, including that I am not a Laboura employee or agent, that I will never take money from job seekers or promise jobs, and the payout and TDS rules.' },
  },
  call_recording: {
    en: { title: 'Call recording', description: 'I consent to calls with Laboura being recorded for verification, coordination and quality.' },
  },
  aadhaar_verification: {
    en: { title: 'ID check and selfie', description: 'I consent to Laboura checking my ID (Aadhaar Secure QR or another ID) and taking a live selfie, keeping only what clause 9.2 lists.' },
  },
};

/** Business Hiring Agreement v1.1, "Signing by OTP". */
export const BUSINESS_CONSENT_NOTICES: Record<string, Notice> = {
  agreement_terms: {
    en: { title: 'I agree to these terms', description: 'On behalf of the business, including the fee plus GST, payment at selection, the guarantee and its claim reasons, and the no-bypass rule.' },
  },
  agreement_authority: {
    en: { title: 'I have authority', description: 'I have authority to agree on the business’s behalf (as owner, manager, HR or an authorised person).' },
  },
  call_recording: {
    en: { title: 'I agree my calls with Laboura are recorded', description: 'Including calls Laboura connects with candidates, for quality, service and resolving disputes.' },
  },
};
