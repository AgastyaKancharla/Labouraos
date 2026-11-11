import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { PortalDef } from '../../portals';
import { screenPath } from '../../portals';

/** GET /search — the search bar on every staff screen (guide, "Search on every screen"). */
export type SearchType = 'job_seeker' | 'business' | 'referral' | 'vacancy' | 'placement';

export interface SearchRow {
  type: SearchType;
  id: string;
  code: string;
  name: string;
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

/** A query worth sending: an ID prefix, 4+ digits, or 2+ letters. */
export function isSearchable(q: string): boolean {
  const s = q.trim();
  if (/^(JS|BZ|RF|VC|PL)[-\s]?\d*$/i.test(s)) return true;
  const digits = s.replace(/[\s()+-]/g, '');
  if (/^\d+$/.test(digits)) return digits.length >= 4;
  return s.length >= 2;
}

export function useSearch(q: string, type?: SearchType | null) {
  const query = q.trim();
  return useQuery({
    queryKey: ['search', query, type ?? 'all'],
    queryFn: ({ signal }) => api.get<SearchResult>('/search', { query: { q: query, type: type ?? undefined }, signal }),
    enabled: isSearchable(query),
    staleTime: 15_000,
  });
}

/**
 * Where a result opens in this portal: the call agent console's one profile
 * (CA04), or the portal's own detail screen for that kind of record.
 */
const DETAIL_SCREENS: Record<SearchType, string[]> = {
  job_seeker: ['CA04-Profile', 'C-JobSeeker'],
  business: ['CA04-Profile', 'C-Business'],
  referral: ['CA04-Profile', 'C-Partner'],
  vacancy: ['CA04-Profile', 'C-Vacancy'],
  placement: ['CA04-Profile', 'C-Placement'],
};

export function resultPath(portal: PortalDef, row: SearchRow): string | null {
  for (const id of DETAIL_SCREENS[row.type]) {
    if (!portal.screens.some((s) => s.id === id)) continue;
    const ownScreen = id.startsWith('C-');
    return screenPath(portal, id, { id: ownScreen ? row.code : row.openRef });
  }
  return null;
}
