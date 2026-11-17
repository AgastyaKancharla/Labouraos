import { LEGAL_DOCUMENT_VERSIONS } from '../legal/legal-documents';

/**
 * Referral Partner Terms v1.0 (Master Guide rev 176). The full text in
 * English (rev 193) lives in src/modules/legal/content and is
 * rendered by LegalDocumentService; the signed copy is stored as a
 * LegalAcceptance with the exact text.
 */
export const REFERRAL_TERMS_VERSION = LEGAL_DOCUMENT_VERSIONS.referral_terms;

export type AgreementLanguage = 'en';
