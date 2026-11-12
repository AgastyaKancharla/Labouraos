import { Stack } from 'expo-router';

/**
 * The Visits tab keeps its own stack, so the tab bar stays visible through the
 * shop-visit flow (FA20 → FA21 → FA22 / FA06c, FA06, FA06b), as in the designs.
 * The visits list (FA05) is always underneath, so back returns to it.
 */
export const unstable_settings = { anchor: 'visits' };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
