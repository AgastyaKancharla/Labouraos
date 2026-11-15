import { Tabs } from 'expo-router';
import { TabBar, type TabItem } from '@/components';
import { useI18n } from '@/i18n';

/**
 * Home · Visits · Job seekers · Vacancies · Map · Targets (guide: field agent app tabs).
 * Home, Visits, Job seekers and Vacancies each keep their own stack (the
 * `(home)` and `(visits)` groups leave the URLs unchanged), so the tab bar
 * stays visible on every screen opened from them. Back follows the order the
 * tabs were used in, so a visit started from Home or the Map returns there.
 */
export default function TabsLayout() {
  const { t } = useI18n();
  const items = [
    { name: '(home)', label: t('tabs.home'), icon: 'home' },
    { name: '(visits)', label: t('tabs.visits'), icon: 'store' },
    { name: 'job-seekers', label: t('tabs.jobSeekers'), icon: 'users' },
    { name: 'vacancies', label: t('tabs.vacancies'), icon: 'briefcase' },
    { name: 'map', label: t('tabs.map'), icon: 'map' },
    { name: 'targets', label: t('tabs.targets'), icon: 'target' },
  ] satisfies TabItem[];
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      backBehavior="history"
      tabBar={({ state, navigateToTab }) => (
        <TabBar
          items={items}
          activeName={state.routes[state.index]?.name ?? '(home)'}
          onSelect={(name) => {
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
