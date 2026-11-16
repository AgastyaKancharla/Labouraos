import { useMemo } from 'react';
import { router, useSegments } from 'expo-router';
import { sellingRoutesFor, SEARCH_ROUTES, TAB_ROOTS, type SellingBase, type TabName } from './routes';

const TABS = Object.keys(TAB_ROOTS) as TabName[];

/** The tab the current screen sits in (from the route's segments), Today when unknown. */
export function useCurrentTab(): TabName {
  const segments = useSegments() as string[];
  return (segments.find((s) => (TABS as string[]).includes(s)) as TabName | undefined) ?? '(today)';
}

/** The candidates flow's routes for the tab this screen is in: Visits (`/visit/...`) or Businesses. */
export function useSellingRoutes() {
  const tab = useCurrentTab();
  const base: SellingBase = tab === '(visits)' ? '/visit' : '/businesses';
  return useMemo(() => sellingRoutesFor(base), [base]);
}

/** The main page of the current tab, and its search page. */
export function useTabRoot(): { tab: TabName; root: string; search: string } {
  const tab = useCurrentTab();
  return { tab, root: TAB_ROOTS[tab], search: SEARCH_ROUTES[tab] };
}

/**
 * The back arrow: one step back inside the tab, or the tab's main page when
 * there is nothing to go back to (a screen opened from a link). Screens keep
 * what was typed (`useFormDraft`), so going back never loses it.
 */
export function goBack(fallback: string): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** Leave a job for later: back to the tab's main page, closing the job's screens (it then shows in Needs you now). */
export function finishLater(root: string): void {
  if (router.canDismiss()) router.dismissTo(root);
  else router.replace(root);
}
