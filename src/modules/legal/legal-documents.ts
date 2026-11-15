import { createHash } from 'crypto';
import { calculateGst, calculatePlacementFee, formatINR } from '../../common/money/money';
import { escapeHtml, renderInline, renderMarkdown } from './legal-markdown';
import { LegalDocumentSource, LegalLanguage } from './legal-document.types';
import { JOB_SEEKER_TERMS_EN } from './content/job-seeker-terms.en';
import { JOB_SEEKER_TERMS_KN } from './content/job-seeker-terms.kn';
import { JOB_SEEKER_TERMS_HI } from './content/job-seeker-terms.hi';
import { BUSINESS_AGREEMENT_EN } from './content/business-agreement.en';
import { BUSINESS_AGREEMENT_KN } from './content/business-agreement.kn';
import { BUSINESS_AGREEMENT_HI } from './content/business-agreement.hi';
import { REFERRAL_TERMS_EN } from './content/referral-terms.en';
import { REFERRAL_TERMS_KN } from './content/referral-terms.kn';
import { REFERRAL_TERMS_HI } from './content/referral-terms.hi';

/**
 * The three legal documents (Master Guide rev 176, decided 15 Nov), as
 * versioned content in Kannada, Hindi and English.
 *
 * The English is the owner-approved text. The Kannada and Hindi are MACHINE
 * DRAFTS written for the test setup: they must be reviewed by a native
 * speaker (and the lawyer) before launch.
 *
 * Raising a version here makes everyone who accepted an older one accept the
 * new one the next time they open their link, Laboura Field or the app
 * (legal-acceptance.service.ts). A running job seeker guarantee keeps the
 * version it was paid under (job seeker terms 18.2); a paid placement keeps
 * the agreement version it was paid under (business agreement 17.1).
 */
export const LEGAL_DOCUMENT_KEYS = ['job_seeker_terms', 'business_agreement', 'referral_terms'] as const;
export type LegalDocumentKey = (typeof LEGAL_DOCUMENT_KEYS)[number];

export const LEGAL_DOCUMENT_VERSIONS: Record<LegalDocumentKey, string> = {
  job_seeker_terms: '1.1',
  business_agreement: '1.1',
  referral_terms: '1.0',
};

/** Who accepts which document. */
export const LEGAL_DOCUMENT_FOR_SUBJECT: Record<'job_seeker' | 'business' | 'referral', LegalDocumentKey> = {
  job_seeker: 'job_seeker_terms',
  business: 'business_agreement',
  referral: 'referral_terms',
};

const SOURCES: Record<LegalDocumentKey, Record<LegalLanguage, LegalDocumentSource>> = {
  job_seeker_terms: { en: JOB_SEEKER_TERMS_EN, kn: JOB_SEEKER_TERMS_KN, hi: JOB_SEEKER_TERMS_HI },
  business_agreement: { en: BUSINESS_AGREEMENT_EN, kn: BUSINESS_AGREEMENT_KN, hi: BUSINESS_AGREEMENT_HI },
  referral_terms: { en: REFERRAL_TERMS_EN, kn: REFERRAL_TERMS_KN, hi: REFERRAL_TERMS_HI },
};

export function isLegalDocumentKey(value: unknown): value is LegalDocumentKey {
  return typeof value === 'string' && (LEGAL_DOCUMENT_KEYS as readonly string[]).includes(value);
}

export function legalDocumentSource(key: LegalDocumentKey, language: LegalLanguage): LegalDocumentSource {
  return SOURCES[key][language];
}

/** The company details the CEO enters in Settings; empty until Laboura is registered. */
export interface LegalCompanyDetails {
  legalName: string;
  cin: string | null;
  registeredOffice: string | null;
  gstin: string | null;
  grievanceOfficerName: string | null;
  grievanceOfficerPhone: string | null;
  grievanceOfficerEmail: string | null;
}

/** The Settings numbers the texts quote. Money in paise. */
export interface LegalNumbers {
  activationFeePaise: number;
  jobSeekerGuaranteeDays: number;
  offerReplyHours: number;
  maxHits: number;
  joiningRewardPaise: number;
  joiningRewardAfterDays: number;
  registrationLinkValidHours: number;
  paymentOnlyLinkMinutes: number;
  placementFeePercent: number;
  gstPercent: number;
  placementPaymentDueHours: number;
  interviewResultEscalateHours: number;
  replacementWindowDays: number;
  maxFreeReplacements: number;
  maxReplacementRejections: number;
  replacementSearchDays: number;
  claimReportDays: number;
  claimDecisionHours: number;
  noBypassMonths: number;
  noBypassPenaltyPercent: number;
  referralPayoutPaise: number;
  payoutDetailsCoolingHours: number;
}

const NOT_YET: Record<LegalLanguage, string> = {
  en: 'to be added after registration',
  kn: 'ನೋಂದಣಿಯ ನಂತರ ಸೇರಿಸಲಾಗುವುದು',
  hi: 'पंजीकरण के बाद जोड़ा जाएगा',
};
const EFFECTIVE: Record<LegalLanguage, string> = {
  en: 'from the day you accept it',
  kn: 'ನೀವು ಒಪ್ಪಿದ ದಿನದಿಂದ',
  hi: 'आपके स्वीकार करने के दिन से',
};
const IN_SHORT: Record<LegalLanguage, string> = { en: 'In short', kn: 'ಸಂಕ್ಷಿಪ್ತವಾಗಿ', hi: 'संक्षेप में' };
const VERSION_WORD: Record<LegalLanguage, string> = { en: 'Version', kn: 'ಆವೃತ್ತಿ', hi: 'संस्करण' };

function filled(value: string | null | undefined): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  return v ? v : null;
}

/** "Name, phone, email" of the Grievance Officer, or the "to be added" words. */
export function grievanceContact(company: LegalCompanyDetails, language: LegalLanguage = 'en'): string {
  const parts = [company.grievanceOfficerName, company.grievanceOfficerPhone, company.grievanceOfficerEmail].map(filled).filter(Boolean);
  return parts.length ? parts.join(', ') : NOT_YET[language];
}

function placeholderValues(numbers: LegalNumbers, company: LegalCompanyDetails, language: LegalLanguage): Record<string, string> {
  const money = (paise: number) => formatINR(paise);
  const fee = (salaryPaise: number) => calculatePlacementFee(salaryPaise, numbers.placementFeePercent);
  const fee10 = fee(1_000_000);
  const fee15 = fee(1_500_000);
  const gst10 = calculateGst(fee10, numbers.gstPercent);
  const gst15 = calculateGst(fee15, numbers.gstPercent);
  const penalty15 = Math.round((fee15 * numbers.noBypassPenaltyPercent) / 100);
  // Clause 10.8 example: ₹12,000 replaced at ₹14,000 — the fee percent on the difference.
  const upgrade = fee(1_400_000 - 1_200_000);
  return {
    'company.name': company.legalName,
    'company.cin': filled(company.cin) ?? NOT_YET[language],
    'company.office': filled(company.registeredOffice) ?? NOT_YET[language],
    'company.gstin': filled(company.gstin) ?? NOT_YET[language],
    'company.effective': EFFECTIVE[language],
    grievance: grievanceContact(company, language),
    fee: money(numbers.activationFeePaise),
    guaranteeDays: String(numbers.jobSeekerGuaranteeDays),
    offerReplyHours: String(numbers.offerReplyHours),
    maxHits: String(numbers.maxHits),
    joiningReward: money(numbers.joiningRewardPaise),
    joiningRewardDays: String(numbers.joiningRewardAfterDays),
    linkHours: String(numbers.registrationLinkValidHours),
    payOnlyMinutes: String(numbers.paymentOnlyLinkMinutes),
    feePercent: String(numbers.placementFeePercent),
    gstPercent: String(numbers.gstPercent),
    paymentDueHours: String(numbers.placementPaymentDueHours),
    resultEscalateHours: String(numbers.interviewResultEscalateHours),
    windowDays: String(numbers.replacementWindowDays),
    maxReplacements: String(numbers.maxFreeReplacements),
    maxRejections: String(numbers.maxReplacementRejections),
    searchDays: String(numbers.replacementSearchDays),
    claimDays: String(numbers.claimReportDays),
    decisionHours: String(numbers.claimDecisionHours),
    noBypassMonths: String(numbers.noBypassMonths),
    penaltyPercent: String(numbers.noBypassPenaltyPercent),
    referralReward: money(numbers.referralPayoutPaise),
    coolingHours: String(numbers.payoutDetailsCoolingHours),
    'ex10.fee': money(fee10),
    'ex10.gst': money(gst10),
    'ex10.total': money(fee10 + gst10),
    'ex10.total3': money((fee10 + gst10) * 3),
    'ex15.fee': money(fee15),
    'ex15.gst': money(gst15),
    'ex15.total': money(fee15 + gst15),
    'ex15.penalty': money(penalty15),
    'ex15.bypass': money(fee15 + penalty15),
    'exUp.diff': money(upgrade),
  };
}

export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([a-zA-Z0-9.]+)\}\}/g, (match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Legal document placeholder {{${name}}} has no value`);
    return value;
  });
}

export interface RenderedLegalDocument {
  key: LegalDocumentKey;
  version: string;
  language: LegalLanguage;
  title: string;
  /** The "In short" lines, as inline HTML. */
  summary: string[];
  summaryHtml: string;
  /** The full text. */
  bodyHtml: string;
  /** The exact page shown: title, version, "In short" and the full text. Stored as the signed copy. */
  html: string;
  /** sha256 of `html`. */
  hash: string;
}

export function renderLegalDocument(
  key: LegalDocumentKey,
  language: LegalLanguage,
  numbers: LegalNumbers,
  company: LegalCompanyDetails,
): RenderedLegalDocument {
  const source = legalDocumentSource(key, language);
  const values = placeholderValues(numbers, company, language);
  const version = LEGAL_DOCUMENT_VERSIONS[key];
  const summary = source.summary.map((line) => renderInline(fillPlaceholders(line, values)));
  const summaryHtml = `<section class="lb-legal__short"><h2>${escapeHtml(IN_SHORT[language])}</h2><ul>${summary.map((line) => `<li>${line}</li>`).join('')}</ul></section>`;
  const bodyHtml = `<section class="lb-legal__full">${renderMarkdown(fillPlaceholders(source.body, values))}</section>`;
  const title = fillPlaceholders(source.title, values);
  const html =
    `<article class="lb-legal" lang="${language}" data-document="${key}" data-template-version="${version}">` +
    `<header><h1>${escapeHtml(company.legalName)} — ${escapeHtml(title)}</h1><p class="lb-legal__version">${escapeHtml(VERSION_WORD[language])} ${escapeHtml(version)}</p></header>` +
    summaryHtml +
    bodyHtml +
    '</article>';
  return {
    key,
    version,
    language,
    title,
    summary,
    summaryHtml,
    bodyHtml,
    html,
    hash: hashLegalText(html),
  };
}

export function hashLegalText(html: string): string {
  return createHash('sha256').update(html, 'utf8').digest('hex');
}
