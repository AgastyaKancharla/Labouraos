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
  // Requests waiting for this Team Lead or Manager (GET /requests/waiting, scoped by the reporting line).
  'requests-open': async () => (await api.get<unknown[]>('/requests/waiting')).length,
  // Team Lead sidebar (GET /team-lead/*, Team Leads only).
  'calls-to-review': async () => (await api.get<{ summary: { toListen: number } }>('/team-lead/quality')).summary.toListen,
  'registrations-to-check': async () => (await api.get<{ summary: { toCheck: number } }>('/team-lead/registrations')).summary.toCheck,
  'visit-proof-to-check': async () => (await api.get<{ summary: { toCheck: number } }>('/team-lead/visits')).summary.toCheck,
  // Finance sidebar (GET /finance/counts, Finance and CEO only).
  'bank-credits-unmatched': async () => (await financeCounts()).bankCreditsUnmatched,
  'invoices-unpaid': async () => (await financeCounts()).invoicesUnpaid,
  'payouts-due': async () => (await financeCounts()).payoutsDue,
  'expenses-to-approve': async () => (await financeCounts()).expensesToApprove,
};

interface FinanceCounts {
  bankCreditsUnmatched: number;
  invoicesUnpaid: number;
  payoutsDue: number;
  expensesToApprove: number;
}

/** One request serves the four Finance badges refreshed together. */
let financeCountsInFlight: { at: number; promise: Promise<FinanceCounts> } | null = null;
function financeCounts(): Promise<FinanceCounts> {
  const now = Date.now();
  if (!financeCountsInFlight || now - financeCountsInFlight.at > 5_000) {
    financeCountsInFlight = { at: now, promise: api.get<FinanceCounts>('/finance/counts') };
  }
  return financeCountsInFlight.promise;
}

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
