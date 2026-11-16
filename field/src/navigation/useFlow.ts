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

/** The parts of a navigation object the back arrow uses (react-navigation). */
export interface ParentNavigation {
  getParent?: () => ParentNavigation | undefined;
  getState?: () => { index: number; routes: { key: string; name: string; params?: object }[] } | undefined;
  dispatch?: (action: { type: string; payload: object; source?: string }) => void;
}

/** Keys react-navigation uses to open a screen inside a navigator: always kept. */
const NAVIGATION_KEYS = new Set(['screen', 'params', 'initial', 'path', 'state']);

/** Replaces a route's params with only its navigation keys (drops the copies of the link's params). */
function dropCopiedParams(navigation: ParentNavigation, route: { key: string; params?: object } | undefined): void {
  const params = (route?.params ?? {}) as Record<string, unknown>;
  const kept = Object.fromEntries(Object.entries(params).filter(([k]) => NAVIGATION_KEYS.has(k)));
  if (route && Object.keys(kept).length < Object.keys(params).length) {
    navigation.dispatch?.({ type: 'REPLACE_PARAMS', payload: { params: kept }, source: route.key });
  }
}

/**
 * A screen opened straight from a link (e.g. /visit/details/<id>) hands its
 * params to the tab's main page put underneath it (the stack's anchor) and
 * to the tab and layout routes above it, so the back arrow landed on
 * /visits?id=… (fix list A8). The main pages take no params, so this drops
 * those copies and the main page opens on its clean path. A real screen
 * underneath (e.g. the business page under its vacancy) keeps its params.
 */
export function clearInheritedParams(navigation: ParentNavigation | undefined): void {
  if (!navigation) return;
  const state = navigation.getState?.();
  const below = state && state.index > 0 ? state.routes[state.index - 1] : undefined;
  if (below && /(^|\/)index$/.test(below.name)) dropCopiedParams(navigation, below);
  let nav = navigation.getParent?.();
  while (nav) {
    const parent = nav.getState?.();
    dropCopiedParams(nav, parent?.routes[parent.index]);
    nav = nav.getParent?.();
  }
}

/**
 * The back arrow: one step back inside the tab, or the tab's main page when
 * there is nothing to go back to (a screen opened from a link), always on
 * the main page's clean path. Screens keep what was typed (`useFormDraft`),
 * so going back never loses it.
 */
export function goBack(fallback: string, navigation?: ParentNavigation): void {
  clearInheritedParams(navigation);
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** Leave a job for later: back to the tab's main page, closing the job's screens (it then shows in Needs you now). */
export function finishLater(root: string): void {
  if (router.canDismiss()) router.dismissTo(root);
  else router.replace(root);
}
