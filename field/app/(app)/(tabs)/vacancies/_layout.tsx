import { Stack } from 'expo-router';

/**
 * The Vacancies tab keeps its own stack, so the tab bar stays visible through
 * the flow (FA19 → FA17 → FA17b). The list (FA19) is always underneath, so back
 * returns to it even when a screen is opened straight from its URL. The anchor
 * inherits that screen's params; FA19 reads none.
 */
export const unstable_settings = { anchor: 'index' };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
