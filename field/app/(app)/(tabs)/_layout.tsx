import { Tabs } from 'expo-router';
import { TabBar } from '@/components';
import { useI18n } from '@/i18n';

/** Home · Visits · Job seekers · Vacancies · Map · Targets (guide: field agent app tabs). */
export default function TabsLayout() {
  const { t } = useI18n();
  const items = [
    { name: 'index', label: t('tabs.home') },
    { name: 'visits', label: t('tabs.visits') },
    { name: 'job-seekers', label: t('tabs.jobSeekers') },
    { name: 'vacancies', label: t('tabs.vacancies') },
    { name: 'map', label: t('tabs.map') },
    { name: 'targets', label: t('tabs.targets') },
  ];
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigateToTab }) => (
        <TabBar
          items={items}
          activeName={state.routes[state.index]?.name ?? 'index'}
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
