import { Stack } from 'expo-router';

/**
 * The Job seekers tab: the job seekers this agent registered, + Job seeker (FA10 → FA10b → FA10c) and referral partner registration.
 * The main page (index) is always underneath, so back returns to it even when a
 * screen is opened straight from its URL.
 */
export const unstable_settings = { anchor: 'index' };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
