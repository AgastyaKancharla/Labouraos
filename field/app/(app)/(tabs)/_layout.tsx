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
      tabBar={({ state, navigateToTab }) => (
        <TabBar
          items={items}
          activeName={state.routes[state.index]?.name ?? '(today)'}
          onSelect={(name) => {
            const focused = state.routes[state.index]?.name === name;
            if (focused) {
              // Already here: back to the tab's main page.
              if (router.canDismiss()) router.dismissTo(TAB_ROOTS[name as TabName]);
              return;
            }
            const route = state.routes.find((r) => r.name === name);
            if (route) navigateToTab(route.key);
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
