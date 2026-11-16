import { Stack } from 'expo-router';

/**
 * The Visits tab: every step of a visit and of onboarding the shop it leads to (FA20 → FA21 → FA22 → FA07 → agreement → vacancies → candidates), verification visits (FA06), visit details, Today's work and Shops near me. A job never leaves this tab halfway.
 * The main page (visits/index) is always underneath, so back returns to it even when a
 * screen is opened straight from its URL.
 */
export const unstable_settings = { anchor: 'visits/index' };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
