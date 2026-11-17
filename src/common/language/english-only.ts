/**
 * English only, everywhere (Master Guide rev 193, decided 17 Nov 2026): every
 * staff app, the customer app, the public pages (agreement, vacancy, job
 * seeker and partner links), read-aloud scripts and every SMS, WhatsApp and
 * push message are in English. Nothing offers or sends another language.
 *
 * The old per-person language columns (JobSeeker.messageLanguage,
 * Business.contactLanguage, Referral.language, CustomerAccount.language…)
 * are kept so old rows and old app versions still work, but whatever they or
 * a request say, the product uses English. Records of what someone accepted
 * earlier (Consent.language, LegalAcceptance.language, LegalDocumentText) are
 * history and are never rewritten.
 */
export type ProductLanguage = 'en';

export const PRODUCT_LANGUAGE: ProductLanguage = 'en';

/** The language to use for a person or a request: always English (an old 'kn' or 'hi' is read as English). */
export function productLanguage(requested?: unknown): ProductLanguage {
  void requested; // read and ignored on purpose
  return PRODUCT_LANGUAGE;
}
