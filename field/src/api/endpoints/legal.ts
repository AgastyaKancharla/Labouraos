import type { ApiClient } from '../client';

/**
 * Legal documents v1.1 (Master Guide rev 176): the server renders each text
 * from its versioned content. Laboura Field reads the "In short" aloud to
 * the person before their OTP, in English (rev 193). Which version a person
 * accepted comes on the (scoped) registration status screen.
 */
export type LegalDocumentKey = 'job_seeker_terms' | 'business_agreement' | 'referral_terms';

export interface LegalDocument {
  key: LegalDocumentKey;
  version: string;
  language: 'en';
  title: string;
  summary: string[];
  summaryHtml: string;
  bodyHtml: string;
  /** Notice 1.3 (rev 211): the job seeker's "30 days start only after your ID is verified" line. */
  consentNotice?: string | null;
}

export const legalApi = (api: ApiClient) => ({
  document: (key: LegalDocumentKey, language: 'en' = 'en') =>
    api.get<LegalDocument>(`/legal/documents/${key}`, { query: { lang: language }, auth: false }),
});

/** An "In short" line as plain text (the server sends inline HTML: <strong> only). */
export function inShortText(doc: LegalDocument): string {
  const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  // Notice 1.3 (rev 211): read the "30 days start after the ID check" line aloud too.
  const notice = doc.consentNotice ? `\n\n${doc.consentNotice}` : '';
  return `${doc.summary.map((line) => `• ${plain(line)}`).join('\n')}${notice}\n\n(${doc.title} · v${doc.version})`;
}
