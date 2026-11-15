import type { ApiClient } from '../client';

/**
 * Legal documents v1.1 (Master Guide rev 176): the server renders each text
 * from its versioned content. Laboura Field reads the "In short" aloud to
 * the person before their OTP, in their language. Which version a person
 * accepted comes on the (scoped) registration status screen.
 */
export type LegalDocumentKey = 'job_seeker_terms' | 'business_agreement' | 'referral_terms';

export interface LegalDocument {
  key: LegalDocumentKey;
  version: string;
  language: 'kn' | 'hi' | 'en';
  title: string;
  summary: string[];
  summaryHtml: string;
  bodyHtml: string;
}

export const legalApi = (api: ApiClient) => ({
  document: (key: LegalDocumentKey, language: string) =>
    api.get<LegalDocument>(`/legal/documents/${key}`, { query: { lang: language }, auth: false }),
});

/** An "In short" line as plain text (the server sends inline HTML: <strong> only). */
export function inShortText(doc: LegalDocument): string {
  const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return `${doc.summary.map((line) => `• ${plain(line)}`).join('\n')}\n\n(${doc.title} · v${doc.version})`;
}
