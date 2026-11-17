/**
 * One language of one legal document. `summary` is the "In short" box (one
 * line per bullet); `body` is the full text in a small Markdown subset
 * (headings, paragraphs, lists, tables, **bold**, *italic*, `code`), rendered
 * by legal-markdown.ts. `{{name}}` placeholders are filled from Settings
 * (PricingPolicy) and the company details the CEO enters (legal-document.service.ts).
 */
export interface LegalDocumentSource {
  title: string;
  summary: string[];
  body: string;
}

/** English only (Master Guide rev 193). Acceptances recorded earlier in Kannada or Hindi keep their stored text (LegalDocumentText). */
export const LEGAL_LANGUAGES = ['en'] as const;
export type LegalLanguage = (typeof LEGAL_LANGUAGES)[number];

export function isLegalLanguage(value: unknown): value is LegalLanguage {
  return typeof value === 'string' && (LEGAL_LANGUAGES as readonly string[]).includes(value);
}
