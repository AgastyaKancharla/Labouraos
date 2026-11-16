import { Stack } from 'expo-router';

/**
 * The Businesses tab: my businesses, the one business page (FA08), + Vacancy, vacancy confirmation, candidates, calling, the owner's decision, booking, selected and paid, joining and calling the owner.
 * The main page (index) is always underneath, so back returns to it even when a
 * screen is opened straight from its URL.
 */
export const unstable_settings = { anchor: 'index' };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
