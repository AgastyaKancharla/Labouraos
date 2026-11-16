import { Stack } from 'expo-router';

/**
 * The Today tab: Today (FA03), Search and the fee calculator (FA14).
 * The main page (index) is always underneath, so back returns to it even when a
 * screen is opened straight from its URL.
 */
export const unstable_settings = { anchor: 'index' };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
