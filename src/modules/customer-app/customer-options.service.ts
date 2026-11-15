import { HttpStatus, Injectable } from '@nestjs/common';
import { LegalDocumentService } from '../legal/legal-document.service';
import { LEGAL_DOCUMENT_FOR_SUBJECT } from '../legal/legal-documents';
import { isLegalLanguage } from '../legal/legal-document.types';
import { CustomerSignInService } from '../customer-account/customer-sign-in.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerScopeService } from '../../common/customer-auth/customer-scope.service';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';
import { CUSTOMER_BUSINESS_ROLES, CUSTOMER_LANGUAGES } from '../../common/customer-auth/customer-app.constants';
import { PricingService } from '../pricing/pricing.service';
import { JOB_TYPES, REGISTRATION_WINDOWS, SHIFT_PREFERENCES } from '../job-seeker/job-seeker.validator';
import {
  BUSINESS_TYPES,
  EMPLOYEE_COUNT_BANDS,
  HIRING_FREQUENCIES,
  YEARS_RUNNING_BANDS,
} from '../business/business.constants';
import { VACANCY_EXTRAS } from '../vacancy/vacancy.constants';
import { ConsentLinkService } from '../consent/consent-link.service';

/** Languages people commonly speak in Bengaluru: suggestions; the form also takes others. */
const SPOKEN_LANGUAGE_SUGGESTIONS = ['Kannada', 'Hindi', 'English', 'Tamil', 'Telugu', 'Malayalam', 'Marathi', 'Bengali', 'Odia', 'Urdu'];
const REFERRAL_INDIVIDUAL_ROLES = ['auto_driver', 'shop_staff', 'shop_owner', 'security_guard', 'existing_worker', 'other'];
const CALLBACK_TOPICS = ['signup', 'payment', 'interview', 'refund', 'payout', 'vacancy', 'other'];

/**
 * What the app's registration and vacancy forms need to show (Agent B's ask):
 * the managed area and trade lists with the market salary ranges, the legal
 * minimum wage per level, and the fixed choices of the agent's forms. Only
 * data that is fine for any signed-in customer to see — no people, no money
 * beyond the published wage figures. Also "My papers": a person's own signed
 * documents.
 */
@Injectable()
export class CustomerOptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly scope: CustomerScopeService,
    private readonly consentLinks: ConsentLinkService,
    private readonly legal: LegalDocumentService,
    private readonly signIn: CustomerSignInService,
  ) {}

  /** GET /me/profiles/:profileId/legal: the current terms for this profile, "In short" + full text + ticks. */
  async legalDocument(accountId: string, profileId: string, lang: unknown) {
    const profile = await this.scope.profile(accountId, profileId);
    const subjectType = profile.kind as 'job_seeker' | 'business' | 'referral';
    const subjectId = (profile.jobSeekerId ?? profile.referralId ?? profile.businessId)!;
    const key = LEGAL_DOCUMENT_FOR_SUBJECT[subjectType];
    const language = isLegalLanguage(lang) ? lang : 'en';
    const [status, document] = await Promise.all([this.legal.status(subjectType, subjectId), this.legal.publicDocument(key, language)]);
    return { status, document };
  }

  /**
   * POST /me/profiles/:profileId/legal/accept: re-consent in the app, proved
   * by a fresh OTP (step-up 'accept_terms'). A business signs the new
   * agreement on its business_agreement link instead.
   */
  async acceptLegal(accountId: string, sessionId: string, profileId: string, body: Record<string, unknown>) {
    const profile = await this.scope.profile(accountId, profileId);
    if (profile.kind === 'business') {
      throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.NOT_ALLOWED, 'Sign the updated business agreement on its link');
    }
    const language = isLegalLanguage(body.language) ? body.language : 'en';
    const purposes = Array.isArray(body.purposes) ? body.purposes.filter((p): p is string => typeof p === 'string') : [];
    await this.signIn.consumeStepUp(sessionId, 'accept_terms');
    const subjectType = profile.kind === 'job_seeker' ? 'job_seeker' : 'referral';
    const subjectId = (profile.jobSeekerId ?? profile.referralId)!;
    return this.consentLinks.recordReconsent(subjectType, subjectId, { purposes, language, method: 'in_app', otpRequestId: `customer-step-up:${sessionId}` });
  }

  async formOptions() {
    const [policy, areas, trades] = await Promise.all([
      this.pricing.current(),
      this.prisma.area.findMany({
        where: { active: true, mergedIntoId: null },
        orderBy: { name: 'asc' },
        select: { name: true, pincode: true, latitude: true, longitude: true },
      }),
      this.prisma.trade.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { name: true, salaryMinPaise: true, salaryMaxPaise: true, minimumWageLevel: true },
      }),
    ]);
    const legalMinimumWagePaise: Record<string, number> = {
      unskilled: policy.legalMinimumWageUnskilledPaise,
      semi_skilled: policy.legalMinimumWageSemiSkilledPaise,
      skilled: policy.legalMinimumWageSkilledPaise,
      highly_skilled: policy.legalMinimumWageHighlySkilledPaise,
    };
    return {
      languages: { app: CUSTOMER_LANGUAGES, spokenSuggestions: SPOKEN_LANGUAGE_SUGGESTIONS },
      areas,
      trades: trades.map((t) => ({
        name: t.name,
        marketSalaryMinPaise: t.salaryMinPaise,
        marketSalaryMaxPaise: t.salaryMaxPaise,
        minimumWageLevel: t.minimumWageLevel,
        legalMinimumPaise: legalMinimumWagePaise[t.minimumWageLevel] ?? policy.legalMinimumWageUnskilledPaise,
      })),
      /** An unlisted trade ("Other") is checked against the unskilled figure. */
      legalMinimumWagePaise,
      legalMinimumWageEffectiveFrom: policy.legalMinimumWageEffectiveFrom,
      salaryDaysPerMonth: policy.salaryDaysPerMonth,
      adultMinimumAge: policy.adultMinimumAge,
      jobSeeker: {
        bestTimeToCall: Object.keys(REGISTRATION_WINDOWS),
        shiftPreferences: SHIFT_PREFERENCES,
        jobTypes: JOB_TYPES,
        salaryPeriods: ['monthly', 'daily'],
        maxTrades: 3,
      },
      business: {
        // Households stay hidden in the app until the guide decides (C24).
        businessTypes: BUSINESS_TYPES.filter((type) => type !== 'household'),
        contactRoles: CUSTOMER_BUSINESS_ROLES,
        employeeCountBands: EMPLOYEE_COUNT_BANDS,
        yearsRunningBands: YEARS_RUNNING_BANDS,
        hiringFrequencies: HIRING_FREQUENCIES,
      },
      referral: { types: ['individual', 'business'], individualRoles: REFERRAL_INDIVIDUAL_ROLES },
      vacancy: { extras: VACANCY_EXTRAS, interviewTypes: ['walk_in', 'scheduled'], salaryPeriods: ['monthly', 'daily'] },
      callbackTopics: CALLBACK_TOPICS,
    };
  }

  /** GET /me/profiles/:profileId/documents: my own signed papers (proposal 2.1 "My documents", 2.3, 9). */
  async documents(accountId: string, profileId: string) {
    const profile = await this.scope.profile(accountId, profileId);
    const subjectType = profile.kind;
    const subjectId = profile.jobSeekerId ?? profile.referralId ?? profile.businessId!;
    // Consents belong to the whole business: a branch manager does not see them.
    const consents = profile.branchId ? [] : await this.prisma.consent.findMany({
      where: { subjectType, subjectId, granted: true },
      orderBy: { grantedAt: 'asc' },
      select: { purpose: true, noticeVersion: true, language: true, method: true, grantedAt: true, withdrawnAt: true },
    });
    const documents: Array<{ kind: string; title: string; signedAt: Date | null; download: string | null }> = [];
    if (profile.kind === 'referral') {
      const terms = await this.signedReferralTerms(profile.referralId!);
      if (terms) documents.push({ kind: 'referral_terms', title: 'Referral partner terms', signedAt: terms.signedAt, download: `documents/referral_terms` });
    }
    if (profile.kind === 'business' && profile.role === 'owner' && !profile.branchId) {
      const agreement = await this.prisma.businessAgreement.findFirst({ where: { businessId: profile.businessId! }, orderBy: { signedAt: 'desc' }, select: { signedAt: true } });
      if (agreement) documents.push({ kind: 'business_agreement', title: 'Business agreement', signedAt: agreement.signedAt, download: `documents/business_agreement` });
    }
    return { consents, documents };
  }

  /** The terms text the partner agreed to: kept on the link they signed with. */
  private async signedReferralTerms(referralId: string): Promise<{ html: string; signedAt: Date | null } | null> {
    // Signed under the v1.0 full text (rev 176): the exact text kept with the acceptance.
    const accepted = await this.prisma.legalAcceptance.findFirst({
      where: { subjectType: 'referral', subjectId: referralId, documentKey: 'referral_terms' },
      orderBy: { acceptedAt: 'desc' },
      select: { acceptedAt: true, text: { select: { html: true } } },
    });
    if (accepted) return { html: accepted.text.html, signedAt: accepted.acceptedAt };
    // The terms on the link the partner actually completed, never a newer unused link.
    const link = await this.prisma.publicLink.findFirst({
      where: { purpose: 'referral_registration', subjectType: 'referral', subjectId: referralId, usedAt: { not: null } },
      orderBy: { usedAt: 'desc' },
      select: { metadata: true, usedAt: true },
    });
    const signed = await this.prisma.consent.findFirst({
      where: { subjectType: 'referral', subjectId: referralId, purpose: 'agreement_terms', granted: true },
      orderBy: { grantedAt: 'desc' },
      select: { grantedAt: true, noticeVersion: true },
    });
    const terms = (link?.metadata as { terms?: { termsHtml?: unknown; version?: unknown } } | null)?.terms;
    if (!signed || typeof terms?.termsHtml !== 'string' || terms.version !== signed.noticeVersion) return null;
    return { html: terms.termsHtml, signedAt: signed.grantedAt };
  }

  /** GET /me/profiles/:profileId/documents/:kind: the signed document itself (HTML). */
  async document(accountId: string, profileId: string, kind: string): Promise<string> {
    const profile = await this.scope.profile(accountId, profileId);
    if (kind === 'referral_terms' && profile.kind === 'referral') {
      const terms = await this.signedReferralTerms(profile.referralId!);
      if (terms) return terms.html;
    }
    if (kind === 'business_agreement' && profile.kind === 'business') {
      this.scope.assertBusinessOwner(profile);
      const signed = await this.consentLinks.getSignedAgreementDocument(profile.businessId!).catch(() => null);
      if (signed) return Buffer.isBuffer(signed.body) ? signed.body.toString('utf8') : String(signed.body);
    }
    throw new CustomerApiError(HttpStatus.NOT_FOUND, CUSTOMER_ERROR_CODES.PROFILE_NOT_FOUND, 'No signed document of this kind');
  }
}
