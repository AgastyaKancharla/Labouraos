import { escapeHtml } from '../legal/legal-markdown';
import { LEGAL_DOCUMENT_VERSIONS } from '../legal/legal-documents';

/**
 * The Business Hiring Agreement (S1, Master Guide rev 176): the FULL v1.1 text
 * in Kannada, Hindi and English lives in src/modules/legal/content and is
 * rendered by LegalDocumentService ("In short" + the full text). The link
 * freezes the fee and no-bypass numbers of the day it was sent; the signed
 * copy is that exact text plus the system's acceptance record.
 */
export const BUSINESS_AGREEMENT_VERSION = LEGAL_DOCUMENT_VERSIONS.business_agreement;

export type AgreementLanguage = 'kn' | 'hi' | 'en';

export interface AgreementTermsNumbers {
  noBypassMonths: number;
  noBypassPenaltyPercent: number;
  feePercent: number;
  gstPercent: number;
}

export interface AgreementAcceptanceRecord {
  businessName: string;
  businessCode: string;
  signedName: string;
  signedRole: string;
  maskedPhone: string;
  otpRequestId: string;
  signedAtIst: string;
  version: string;
  language: AgreementLanguage;
  ticks: string[];
  onboardedBy: string | null;
  billingEmail: string | null;
}

const RECORD_LABELS: Record<AgreementLanguage, Record<string, string>> = {
  en: {
    title: 'Acceptance record (filled in by the system)', business: 'Business', code: 'Laboura ID (BZ-)', branches: 'Branches covered', all: 'All branches',
    name: 'Contact person name', role: 'Role', mobile: 'Verified mobile', otp: 'OTP reference', at: 'Date and time (IST)', version: 'Agreement version',
    language: 'Language', ticks: 'Ticks', onboarded: 'Onboarded by (field agent staff code)', billing: 'Billing email (copy sent to)',
  },
  kn: {
    title: 'ಒಪ್ಪಿಗೆ ದಾಖಲೆ (ವ್ಯವಸ್ಥೆ ತುಂಬಿದ್ದು)', business: 'ವ್ಯಾಪಾರ', code: 'Laboura ID (BZ-)', branches: 'ಒಳಗೊಂಡ ಶಾಖೆಗಳು', all: 'ಎಲ್ಲಾ ಶಾಖೆಗಳು',
    name: 'ಸಂಪರ್ಕ ವ್ಯಕ್ತಿಯ ಹೆಸರು', role: 'ಪಾತ್ರ', mobile: 'ಪರಿಶೀಲಿತ ಮೊಬೈಲ್', otp: 'OTP ರೆಫರೆನ್ಸ್', at: 'ದಿನಾಂಕ ಮತ್ತು ಸಮಯ (IST)', version: 'ಒಪ್ಪಂದದ ಆವೃತ್ತಿ',
    language: 'ಭಾಷೆ', ticks: 'ಟಿಕ್‌ಗಳು', onboarded: 'ನೋಂದಾಯಿಸಿದವರು (ಫೀಲ್ಡ್ ಏಜೆಂಟ್ ಕೋಡ್)', billing: 'ಬಿಲ್ಲಿಂಗ್ ಇಮೇಲ್ (ಪ್ರತಿ ಕಳುಹಿಸಿದ್ದು)',
  },
  hi: {
    title: 'स्वीकृति रिकॉर्ड (सिस्टम द्वारा भरा गया)', business: 'बिज़नेस', code: 'Laboura ID (BZ-)', branches: 'शामिल शाखाएँ', all: 'सभी शाखाएँ',
    name: 'संपर्क व्यक्ति का नाम', role: 'भूमिका', mobile: 'सत्यापित मोबाइल', otp: 'OTP रेफ़रेंस', at: 'तारीख़ और समय (IST)', version: 'एग्रीमेंट संस्करण',
    language: 'भाषा', ticks: 'टिक', onboarded: 'किसने जोड़ा (फ़ील्ड एजेंट कोड)', billing: 'बिलिंग ईमेल (कॉपी भेजी गई)',
  },
};

/**
 * The stored signed copy: the exact terms the owner saw (termsHtml, whose
 * hash was frozen on the link) followed by the acceptance record. Nothing in
 * the terms is changed.
 */
export function renderSignedAgreementDocument(termsHtml: string, record?: AgreementAcceptanceRecord): string {
  if (!record) return termsHtml;
  const l = RECORD_LABELS[record.language] ?? RECORD_LABELS.en;
  const rows: [string, string][] = [
    [l.business, record.businessName],
    [l.code, record.businessCode],
    [l.branches, l.all],
    [l.name, record.signedName],
    [l.role, record.signedRole],
    [l.mobile, record.maskedPhone],
    [l.otp, record.otpRequestId],
    [l.at, record.signedAtIst],
    [l.version, record.version],
    [l.language, record.language],
    [l.ticks, record.ticks.join(' · ')],
    [l.onboarded, record.onboardedBy ?? '—'],
    [l.billing, record.billingEmail ?? '—'],
  ];
  const table = rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('');
  return `<!doctype html><html lang="${record.language}"><head><meta charset="utf-8"><title>${escapeHtml(record.businessName)}</title></head><body>${termsHtml}<section class="lb-legal__record"><h2>${escapeHtml(l.title)}</h2><table><tbody>${table}</tbody></table></section></body></html>`;
}

export function maskAgreementPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `******${digits.slice(-4)}`;
}
