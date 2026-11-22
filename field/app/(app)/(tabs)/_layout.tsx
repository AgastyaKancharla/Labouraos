import { Tabs } from 'expo-router';
import { TabBar, type TabItem } from '@/components';
import { useI18n } from '@/i18n';
import type { TabName } from '@/navigation/routes';

/**
 * Today · Visits · Businesses · Job seekers · Me (Laboura Field redesign,
 * decided 16 Nov): five tabs, each one kind of work, and a job never jumps
 * to another tab halfway. Each tab keeps its own stack, so the tab bar stays
 * visible on every screen.
 *
 * Tapping a tab always returns to its main page: a tab left for another one
 * is reset to its main page (`popToTopOnBlur`), and tapping any tab — the one
 * you are on or another — resets its stack to its main page (`showMain`), even
 * when a page was opened there from another tab with nothing underneath.
 */
export default function TabsLayout() {
  const { t } = useI18n();
  const items = [
    { name: '(today)', label: t('tabs.today'), icon: 'home' },
    { name: '(visits)', label: t('tabs.visits'), icon: 'store' },
    { name: 'businesses', label: t('tabs.businesses'), icon: 'briefcase' },
    { name: 'job-seekers', label: t('tabs.jobSeekersTab'), icon: 'users' },
    { name: 'me', label: t('tabs.me'), icon: 'user' },
  ] satisfies (TabItem & { name: TabName })[];
  return (
    <Tabs
      screenOptions={{ headerShown: false, popToTopOnBlur: true }}
      backBehavior="history"
      tabBar={({ state, descriptors, navigateToTab }) => (
        <TabBar
          items={items}
          activeName={state.routes[state.index]?.name ?? '(today)'}
          onSelect={(name) => {
            const route = state.routes.find((r) => r.name === name);
            if (!route) return;
            // 22 Nov evening (owner's phone): the Businesses tab still opened one business. A business
            // page opened from another tab (Today, Visits, the bell, search) builds the Businesses
            // stack with that page ALONE, no list underneath: nothing to pop or dismiss, so the
            // tab showed the business. The tab's stack is now reset to its main page on every tap.
            showMain(descriptors[route.key]?.navigation, route, TAB_MAIN[name as TabName]);
            if (state.routes[state.index]?.name !== name) navigateToTab(route.key);
          }}
        />
      )}
    >
      {items.map((item) => (
        <Tabs.Screen key={item.name} name={item.name} options={{ title: item.label }} />
      ))}
    </Tabs>
  );
}

/** Each tab's main page: the route name inside its stack. */
export const TAB_MAIN: Record<TabName, string> = {
  '(today)': 'index',
  '(visits)': 'visits/index',
  businesses: 'index',
  'job-seekers': 'index',
  me: 'index',
};

type NestedState = { key?: string; stale?: boolean; index?: number; routes?: { name: string }[] } & Record<string, unknown>;
type TabRoute = { key: string; name: string; state?: NestedState };
type Dispatcher = { dispatch: (action: { type: 'RESET'; payload: NestedState; target?: string }) => void; navigate: (name: string, params?: object) => void };

/**
 * Resets a tab's own stack to its main page, unless it already shows only that page.
 * A stack that was never opened starts on its main page anyway; one opened from another
 * tab may hold just the pushed page (no anchor underneath), so it is reset, not popped.
 */
export function showMain(navigation: unknown, route: TabRoute, main: string) {
  const nested = route.state;
  if (!nested?.routes?.length) return;
  if (nested.routes.length === 1 && nested.routes[0]?.name === main) return;
  const nav = navigation as Dispatcher | undefined;
  if (!nav) return;
  if (nested.key && nested.stale !== true) {
    // React Navigation's reset, sent to the tab's own stack (by its key). Expo Router only takes a
    // complete state: the stack's own, with just the main page (its key is minted by the router).
    nav.dispatch({ type: 'RESET', payload: { ...nested, index: 0, routes: [{ name: main }] }, target: nested.key });
  } else {
    nav.navigate(route.name, { screen: main });
  }
}
