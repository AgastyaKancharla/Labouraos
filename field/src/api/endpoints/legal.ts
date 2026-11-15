import type { ApiClient } from '../client';

/**
 * Legal documents v1.1 (Master Guide rev 176): the server renders each text
 * from its versioned content. Laboura Field reads the "In short" aloud to
 * the person before their OTP, in their language, and shows which version a
 * person accepted.
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

export interface LegalAcceptances {
  status: { documentKey: string; currentVersion: string; acceptedVersion: string | null; needsReconsent: boolean };
  acceptances: { id: string; version: string; language: string; context: string; acceptedAt: string }[];
}

export const legalApi = (api: ApiClient) => ({
  document: (key: LegalDocumentKey, language: string) =>
    api.get<LegalDocument>(`/legal/documents/${key}`, { query: { lang: language }, auth: false }),
  acceptances: (subjectType: 'job_seeker' | 'business' | 'referral', subjectId: string) =>
    api.get<LegalAcceptances>(`/legal/acceptances/${subjectType}/${subjectId}`),
});

/** An "In short" line as plain text (the server sends inline HTML: <strong> only). */
export function inShortText(doc: LegalDocument): string {
  const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return `${doc.summary.map((line) => `• ${plain(line)}`).join('\n')}\n\n(${doc.title} · v${doc.version})`;
}
