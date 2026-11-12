import { Stack } from 'expo-router';

/**
 * The Job seekers tab keeps its own stack, so the tab bar stays visible through
 * the flow (FA15 → FA15b/c → FA15d → FA15e/f/g…). The list (FA15) is always
 * underneath, so back returns to it even when a screen is opened straight from
 * its URL. The anchor inherits that screen's params; FA15 ignores them.
 */
export const unstable_settings = { anchor: 'index' };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
