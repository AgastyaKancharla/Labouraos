import type { ApiClient } from '../client';

/** GET /search — the search bar on every staff screen (src/modules/screens-call-agent/search.service.ts). */
export type SearchType = 'job_seeker' | 'business' | 'referral' | 'vacancy' | 'placement';

export interface SearchRow {
  type: SearchType;
  id: string;
  code: string;
  name: string;
  /** Always the last 4 digits only ("******4412"), never the full number. */
  maskedPhone: string | null;
  status: string | null;
  trade: string | null;
  locality: string | null;
  openRef: string;
  extra: Record<string, string | number | null>;
}

export interface SearchResult {
  query: string;
  kind: 'id' | 'phone' | 'name' | null;
  counts: Record<'all' | SearchType, number>;
  results: SearchRow[];
}

/** A query worth sending: an ID prefix, 4+ digits, or 2+ letters (the server reads it the same way). */
export function isSearchable(q: string): boolean {
  const s = q.trim();
  if (/^(JS|BZ|RF|VC|PL)[-\s]?\d*$/i.test(s)) return true;
  const digits = s.replace(/[\s()+-]/g, '');
  if (/^\d+$/.test(digits)) return digits.length >= 4;
  return s.length >= 2;
}

export const searchApi = (api: ApiClient) => ({
  /** A field agent's search is city-wide (AGENTS.md §7); phone numbers come back masked. */
  search: (q: string, type?: SearchType | null, signal?: AbortSignal) =>
    api.get<SearchResult>('/search', { query: { q: q.trim(), type: type ?? undefined }, signal }),
});
