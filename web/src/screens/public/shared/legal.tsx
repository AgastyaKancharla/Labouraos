import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import type { PublicLanguage } from './api';
import { ActionError, Choice, Loading, Muted, PageTitle } from './ui';

/**
 * Legal documents v1.1 (Master Guide rev 176). Every legal text is rendered by
 * the server from its versioned content (GET /legal/documents/:key) in the
 * person's language: the "In short" box first, the full text under "Read the
 * full terms". The HTML comes from the server's own templates — no user text.
 */
export type LegalDocumentKey = 'job_seeker_terms' | 'business_agreement' | 'referral_terms';

export interface LegalTick {
  purpose: string;
  required: boolean;
  title: string;
  description: string;
  withdrawal: string | null;
}

export interface LegalDocument {
  key: LegalDocumentKey;
  version: string;
  language: PublicLanguage;
  title: string;
  summary: string[];
  summaryHtml: string;
  bodyHtml: string;
  hash: string;
  noticeVersion: string | null;
  consents: LegalTick[];
}

export interface LegalCompany {
  legalName: string;
  cin: string | null;
  registeredOffice: string | null;
  gstin: string | null;
  grievanceOfficer: { name: string | null; phone: string | null; email: string | null };
  grievanceContact: string;
}

/** Which version someone accepted, from the server (re-consent). */
export interface LegalStatusView {
  documentKey: LegalDocumentKey;
  currentVersion: string;
  acceptedVersion: string | null;
  needsReconsent: boolean;
}

const PUBLIC = { auth: false } as const;

export const legalApi = {
  document: (key: LegalDocumentKey, language: string) =>
    api.get<LegalDocument>(`/legal/documents/${key}`, { ...PUBLIC, query: { lang: language } }),
  company: (language: string) => api.get<LegalCompany>('/legal/company', { ...PUBLIC, query: { lang: language } }),
  /** "We've updated our terms" on the job seeker's or partner's link, with the code verified on opening it. */
  reconsent: (token: string, requestId: string, purposes: string[], language: string) =>
    api.post<{ success: boolean; version: string }>('/consent/reconsent', { token, otpRequestId: requestId, purposes, language }, PUBLIC),
};

export function useLegalDocument(key: LegalDocumentKey, enabled = true) {
  const { language } = useI18n();
  return useQuery({
    queryKey: ['legal-document', key, language],
    queryFn: () => legalApi.document(key, language),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** The "In short" box and the full text behind "Read the full terms". */
export function LegalSummary({ summaryHtml, bodyHtml, version }: { summaryHtml: string | null; bodyHtml: string | null; version?: string | null }) {
  const { t } = useI18n();
  return (
    <>
      {summaryHtml && (
        <div className="card lb-legal-short" data-testid="legal-in-short">
          {/* Rendered by the server from its own versioned template; no user text in it. */}
          <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
        </div>
      )}
      {bodyHtml && (
        <details className="card lb-pub-terms" data-testid="legal-full">
          <summary>{t('legal.readFull')}</summary>
          <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        </details>
      )}
      {version && <Muted>{t('legal.version', { version })}</Muted>}
    </>
  );
}

/** The company and Grievance Officer line at the foot of every public page. */
export function LegalFooter() {
  const { t, language } = useI18n();
  const company = useQuery({
    queryKey: ['legal-company', language],
    queryFn: () => legalApi.company(language),
    staleTime: 30 * 60_000,
    retry: false,
  });
  if (!company.data) return null;
  const c = company.data;
  return (
    <footer className="lb-legal-footer" data-testid="legal-footer">
      <span>{t('legal.footer.grievance', { contact: c.grievanceContact })}</span>
      {c.cin && <span>{t('legal.footer.company', { name: c.legalName, cin: c.cin })}</span>}
    </footer>
  );
}

/**
 * The blocking "We've updated our terms" screen on a link: In short, Read
 * full, the itemised ticks (never pre-ticked) and Accept, sent with the code
 * verified when the link was opened.
 */
export function ReconsentForm({
  documentKey,
  acceptedVersion,
  onAccept,
}: {
  documentKey: LegalDocumentKey;
  acceptedVersion: string | null;
  onAccept: (purposes: string[]) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const doc = useLegalDocument(documentKey);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (doc.isLoading) return <Loading />;
  if (!doc.data) return <ActionError error={doc.error} />;
  const d = doc.data;
  const allRequired = d.consents.filter((c) => c.required).every((c) => ticked[c.purpose]);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAccept(d.consents.filter((c) => ticked[c.purpose]).map((c) => c.purpose));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle emoji="📜">{t('legal.updated.title')}</PageTitle>
      <Muted>{acceptedVersion ? t('legal.updated.intro', { old: acceptedVersion, version: d.version }) : t('legal.updated.introNew', { version: d.version })}</Muted>
      <LegalSummary summaryHtml={d.summaryHtml} bodyHtml={d.bodyHtml} version={d.version} />
      <strong>{t('legal.updated.ticks')}</strong>
      {d.consents.map((c) => (
        <Choice
          key={c.purpose}
          checked={Boolean(ticked[c.purpose])}
          onChange={(checked) => setTicked((prev) => ({ ...prev, [c.purpose]: checked }))}
          title={c.title}
          description={c.description}
        />
      ))}
      {!allRequired && <span className="sub">{t('legal.updated.needAll')}</span>}
      <ActionError error={error} />
      <button type="button" className="btn bp full" disabled={!allRequired || busy} aria-busy={busy || undefined} onClick={() => void accept()}>
        {t('legal.updated.accept')}
      </button>
    </>
  );
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * "Read this to them" for an agent (CA08, CA15, Laboura Field): the document's
 * "In short" in each of the three languages, as plain lines. Null until all
 * three have loaded (the caller keeps its older script meanwhile).
 */
export function useInShortScripts(key: LegalDocumentKey): Record<PublicLanguage, string> | null {
  const results = useQueries({
    queries: (['kn', 'hi', 'en'] as const).map((language) => ({
      queryKey: ['legal-document', key, language],
      queryFn: () => legalApi.document(key, language),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  if (!results.every((r) => r.data)) return null;
  const [kn, hi, en] = results.map((r) => r.data!);
  const script = (d: LegalDocument) => `${d.summary.map((line) => `• ${plainText(line)}`).join('\n')}\n\n(${d.title} · v${d.version})`;
  return { kn: script(kn), hi: script(hi), en: script(en) };
}
