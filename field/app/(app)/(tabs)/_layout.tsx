import { router, Tabs } from 'expo-router';
import { TabBar, type TabItem } from '@/components';
import { useI18n } from '@/i18n';
import { TAB_ROOTS, type TabName } from '@/navigation/routes';

/**
 * Today · Visits · Businesses · Job seekers · Me (Laboura Field redesign,
 * decided 16 Nov): five tabs, each one kind of work, and a job never jumps
 * to another tab halfway. Each tab keeps its own stack, so the tab bar stays
 * visible on every screen.
 *
 * Tapping a tab always returns to its main page: a tab left for another one
 * is reset to its main page (`popToTopOnBlur`), and tapping the tab you are
 * on closes everything opened inside it.
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
            const focused = state.routes[state.index]?.name === name;
            const route = state.routes.find((r) => r.name === name);
            // 22 Nov (owner's field test): the Businesses tab opened the last business page (a page
            // pushed from another tab, with nothing to dismiss). The tab's main page is always shown.
            const toMain = () => route && descriptors[route.key]?.navigation.navigate(route.name, { screen: 'index' });
            if (focused) {
              // Already here: back to the tab's main page.
              if (router.canDismiss()) router.dismissTo(TAB_ROOTS[name as TabName]);
              else toMain();
              return;
            }
            if (!route) return;
            navigateToTab(route.key);
            if ((((route as { state?: { index?: number } }).state)?.index ?? 0) > 0) toMain();
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
