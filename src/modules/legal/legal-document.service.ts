import { Injectable } from '@nestjs/common';
import { Prisma, PricingPolicy } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { CONSENT_NOTICES } from '../consent/consent-notices';
import {
  DEFAULT_NOTICE_VERSION,
  JOB_SEEKER_CONSENT_PURPOSES,
  JOB_SEEKER_REQUIRED_CONSENT_PURPOSES,
  REQUIRED_CONSENT_PURPOSES_BY_SUBJECT,
} from '../consent/consent.constants';
import {
  grievanceContact,
  LEGAL_DOCUMENT_FOR_SUBJECT,
  LEGAL_DOCUMENT_VERSIONS,
  LegalCompanyDetails,
  LegalDocumentKey,
  LegalNumbers,
  renderLegalDocument,
  RenderedLegalDocument,
} from './legal-documents';
import { LegalLanguage } from './legal-document.types';

type Client = PrismaService | Prisma.TransactionClient;
export type LegalSubjectType = 'job_seeker' | 'business' | 'referral';

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

export interface LegalStatus {
  documentKey: LegalDocumentKey;
  currentVersion: string;
  /** The version of the last acceptance on record (null: none in the new record yet). */
  acceptedVersion: string | null;
  acceptedLanguage: string | null;
  acceptedAt: Date | null;
  /** Job seekers: the consent notice version of the ticks. */
  noticeVersion: string | null;
  currentNoticeVersion: string | null;
  /** Accepted something before, but not the current version: ask again (blocking) on the next open. */
  needsReconsent: boolean;
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
   * link was sent); everything else comes from today's Settings.
   */
  async render(key: LegalDocumentKey, language: LegalLanguage, numbers: Partial<LegalNumbers> = {}): Promise<RenderedLegalDocument> {
    const policy = await this.pricing.current();
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

  /**
   * Has this person accepted the current version? Someone who accepted
   * nothing yet is not asked to "re-consent" (they go through the normal
   * first steps). Consents given under an older notice stay valid until then.
   */
  async status(subjectType: LegalSubjectType, subjectId: string): Promise<LegalStatus> {
    const documentKey = LEGAL_DOCUMENT_FOR_SUBJECT[subjectType];
    const currentVersion = LEGAL_DOCUMENT_VERSIONS[documentKey];
    const latest = await this.prisma.legalAcceptance.findFirst({
      where: { subjectType, subjectId, documentKey },
      orderBy: { acceptedAt: 'desc' },
      select: { version: true, language: true, acceptedAt: true, noticeVersion: true },
    });
    const currentNoticeVersion = subjectType === 'job_seeker' ? DEFAULT_NOTICE_VERSION : null;
    const base = {
      documentKey,
      currentVersion,
      acceptedVersion: latest?.version ?? null,
      acceptedLanguage: latest?.language ?? null,
      acceptedAt: latest?.acceptedAt ?? null,
      noticeVersion: latest?.noticeVersion ?? null,
      currentNoticeVersion,
    };

    if (subjectType === 'business') {
      const agreement = await this.prisma.businessAgreement.findFirst({
        where: { businessId: subjectId },
        orderBy: { signedAt: 'desc' },
        select: { version: true, signedAt: true },
      });
      if (!agreement) return { ...base, needsReconsent: false };
      // The signed agreement is the business's acceptance record (older ones predate LegalAcceptance).
      const acceptedVersion = latest && latest.acceptedAt >= agreement.signedAt ? latest.version : agreement.version;
      return {
        ...base,
        acceptedVersion,
        acceptedAt: latest?.acceptedAt ?? agreement.signedAt,
        needsReconsent: acceptedVersion !== currentVersion,
      };
    }

    if (latest) {
      const versionOk = latest.version === currentVersion;
      const noticeOk = subjectType !== 'job_seeker' || latest.noticeVersion === currentNoticeVersion;
      return { ...base, needsReconsent: !(versionOk && noticeOk) };
    }

    // No acceptance in the new record: someone who already gave the required
    // consents under an older version accepts the current one once.
    const required = REQUIRED_CONSENT_PURPOSES_BY_SUBJECT[subjectType] ?? [];
    const legacyPurposes = subjectType === 'referral' ? ['agreement_terms'] : [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES];
    const granted = await this.prisma.consent.findMany({
      where: { subjectType, subjectId, granted: true, withdrawnAt: null, purpose: { in: [...new Set([...required, ...legacyPurposes])] } },
      select: { purpose: true },
    });
    const purposes = new Set(granted.map((g) => g.purpose));
    const acceptedBefore = legacyPurposes.every((p) => purposes.has(p));
    return { ...base, needsReconsent: acceptedBefore };
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

/** Referral Partner Terms v1.0, "Your consent" (Kannada and Hindi: machine drafts). */
export const REFERRAL_CONSENT_NOTICES: Record<string, Notice> = {
  agreement_terms: {
    en: { title: 'Referral Partner Terms', description: 'I agree to these Referral Partner Terms, including that I am not a Laboura employee or agent, that I will never take money from job seekers or promise jobs, and the payout and TDS rules.' },
    kn: { title: 'ರೆಫರಲ್ ಪಾಲುದಾರರ ನಿಯಮಗಳು', description: 'ನಾನು Laboura ಉದ್ಯೋಗಿ ಅಥವಾ ಏಜೆಂಟ್ ಅಲ್ಲ, ಉದ್ಯೋಗಾಕಾಂಕ್ಷಿಗಳಿಂದ ಎಂದೂ ಹಣ ತೆಗೆದುಕೊಳ್ಳುವುದಿಲ್ಲ ಅಥವಾ ಕೆಲಸದ ಭರವಸೆ ಕೊಡುವುದಿಲ್ಲ, ಮತ್ತು ಪಾವತಿ ಹಾಗೂ TDS ನಿಯಮಗಳು ಸೇರಿ, ಈ ರೆಫರಲ್ ಪಾಲುದಾರರ ನಿಯಮಗಳಿಗೆ ನಾನು ಒಪ್ಪುತ್ತೇನೆ.' },
    hi: { title: 'रेफ़रल पार्टनर की शर्तें', description: 'इस बात सहित कि मैं Laboura का कर्मचारी या एजेंट नहीं हूँ, नौकरी चाहने वालों से कभी पैसे नहीं लूँगा/लूँगी या नौकरी का वादा नहीं करूँगा/करूँगी, और पेआउट व TDS नियमों सहित, मैं इन रेफ़रल पार्टनर शर्तों पर सहमत हूँ।' },
  },
  call_recording: {
    en: { title: 'Call recording', description: 'I consent to calls with Laboura being recorded for verification, coordination and quality.' },
    kn: { title: 'ಕರೆ ರೆಕಾರ್ಡಿಂಗ್', description: 'ಪರಿಶೀಲನೆ, ಸಮನ್ವಯ ಮತ್ತು ಗುಣಮಟ್ಟಕ್ಕಾಗಿ Laboura ಜೊತೆಗಿನ ಕರೆಗಳು ರೆಕಾರ್ಡ್ ಆಗಲು ಒಪ್ಪುತ್ತೇನೆ.' },
    hi: { title: 'कॉल रिकॉर्डिंग', description: 'सत्यापन, तालमेल और गुणवत्ता के लिए Laboura के साथ कॉल रिकॉर्ड होने पर मैं सहमत हूँ।' },
  },
  aadhaar_verification: {
    en: { title: 'ID check and selfie', description: 'I consent to Laboura checking my ID (Aadhaar Secure QR or another ID) and taking a live selfie, keeping only what clause 9.2 lists.' },
    kn: { title: 'ಗುರುತು ಪರಿಶೀಲನೆ ಮತ್ತು ಸೆಲ್ಫಿ', description: 'ಷರತ್ತು 9.2 ರಲ್ಲಿ ಹೇಳಿದ್ದನ್ನು ಮಾತ್ರ ಇಟ್ಟುಕೊಂಡು, Laboura ನನ್ನ ಗುರುತು ಪರಿಶೀಲಿಸಲು (ಆಧಾರ್ ಸುರಕ್ಷಿತ QR ಅಥವಾ ಬೇರೆ ಗುರುತಿನ ಚೀಟಿ) ಮತ್ತು ಲೈವ್ ಸೆಲ್ಫಿ ತೆಗೆಯಲು ಒಪ್ಪುತ್ತೇನೆ.' },
    hi: { title: 'ID जाँच और सेल्फ़ी', description: 'धारा 9.2 में बताई बातें ही रखते हुए, Laboura को मेरी ID जाँचने (आधार सिक्योर QR या कोई और ID) और लाइव सेल्फ़ी लेने की मैं सहमति देता/देती हूँ।' },
  },
};

/** Business Hiring Agreement v1.1, "Signing by OTP" (Kannada and Hindi: machine drafts). */
export const BUSINESS_CONSENT_NOTICES: Record<string, Notice> = {
  agreement_terms: {
    en: { title: 'I agree to these terms', description: 'On behalf of the business, including the fee plus GST, payment at selection, the guarantee and its claim reasons, and the no-bypass rule.' },
    kn: { title: 'ನಾನು ಈ ನಿಯಮಗಳಿಗೆ ಒಪ್ಪುತ್ತೇನೆ', description: 'ವ್ಯಾಪಾರದ ಪರವಾಗಿ, ಶುಲ್ಕ ಜೊತೆಗೆ GST, ಆಯ್ಕೆಯಲ್ಲಿ ಪಾವತಿ, ಗ್ಯಾರಂಟಿ ಮತ್ತು ಅದರ ಕ್ಲೇಮ್ ಕಾರಣಗಳು, ಮತ್ತು ತಪ್ಪಿಸುವಂತಿಲ್ಲ ನಿಯಮ ಸೇರಿ.' },
    hi: { title: 'मैं इन शर्तों पर सहमत हूँ', description: 'बिज़नेस की ओर से, फ़ीस और GST, चुनने पर भुगतान, गारंटी और उसके दावे के कारण, और दरकिनार न करने के नियम सहित।' },
  },
  agreement_authority: {
    en: { title: 'I have authority', description: 'I have authority to agree on the business’s behalf (as owner, manager, HR or an authorised person).' },
    kn: { title: 'ನನಗೆ ಅಧಿಕಾರವಿದೆ', description: 'ವ್ಯಾಪಾರದ ಪರವಾಗಿ ಒಪ್ಪಲು (ಮಾಲೀಕ, ಮ್ಯಾನೇಜರ್, HR ಅಥವಾ ಅಧಿಕೃತ ವ್ಯಕ್ತಿಯಾಗಿ) ನನಗೆ ಅಧಿಕಾರವಿದೆ.' },
    hi: { title: 'मुझे अधिकार है', description: 'बिज़नेस की ओर से सहमति देने का (मालिक, मैनेजर, HR या अधिकृत व्यक्ति के रूप में) मुझे अधिकार है।' },
  },
  call_recording: {
    en: { title: 'I agree my calls with Laboura are recorded', description: 'Including calls Laboura connects with candidates, for quality, service and resolving disputes.' },
    kn: { title: 'Laboura ಜೊತೆಗಿನ ನನ್ನ ಕರೆಗಳು ರೆಕಾರ್ಡ್ ಆಗಲು ಒಪ್ಪುತ್ತೇನೆ', description: 'ಗುಣಮಟ್ಟ, ಸೇವೆ ಮತ್ತು ವಿವಾದ ಪರಿಹಾರಕ್ಕಾಗಿ, Laboura ಅಭ್ಯರ್ಥಿಗಳೊಂದಿಗೆ ಜೋಡಿಸುವ ಕರೆಗಳು ಸೇರಿ.' },
    hi: { title: 'Laboura के साथ मेरी कॉल रिकॉर्ड होने पर मैं सहमत हूँ', description: 'गुणवत्ता, सेवा और विवाद सुलझाने के लिए, Laboura द्वारा उम्मीदवारों से जोड़ी गई कॉल सहित।' },
  },
};
