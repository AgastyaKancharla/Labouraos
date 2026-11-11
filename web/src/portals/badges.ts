import { useQueries } from '@tanstack/react-query';
import { api } from '../lib/api/client';
import type { BadgeSource, SidebarConfig } from './types';

/**
 * Where the numbers on the sidebar badges come from. A source with no
 * fetcher shows no badge. Add one when the endpoint exists — each fetcher
 * returns the count to show (0 hides the badge).
 */
const FETCHERS: Partial<Record<BadgeSource, () => Promise<number>>> = {
  'login-codes': async () => (await api.get<unknown[]>('/login-codes/pending')).length,
  'review-flags': async () => (await api.get<unknown[]>('/review-flags', { query: { status: 'open' } })).length,
  'refunds-due': async () => (await api.get<unknown[]>('/refunds/due')).length,
};

export const BADGE_REFRESH_MS = 60_000;

export function badgeQueryKey(source: BadgeSource) {
  return ['nav-badge', source] as const;
}

/** Counts for every badge in a sidebar, refreshed every minute. */
export function useNavBadgeCounts(sidebar: SidebarConfig | undefined): Partial<Record<BadgeSource, number>> {
  const sources = Array.from(
    new Set(
      (sidebar?.sections ?? [])
        .flatMap((s) => s.items)
        .map((i) => i.badge?.source)
        .filter((s): s is BadgeSource => !!s && !!FETCHERS[s]),
    ),
  );
  const results = useQueries({
    queries: sources.map((source) => ({
      queryKey: badgeQueryKey(source),
      queryFn: FETCHERS[source] as () => Promise<number>,
      refetchInterval: BADGE_REFRESH_MS,
      staleTime: 30_000,
      retry: false,
    })),
  });
  const counts: Partial<Record<BadgeSource, number>> = {};
  sources.forEach((source, i) => {
    const data = results[i]?.data;
    if (typeof data === 'number') counts[source] = data;
  });
  return counts;
}
