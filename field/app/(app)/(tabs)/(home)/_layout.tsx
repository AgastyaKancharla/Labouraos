import { Stack } from 'expo-router';

/**
 * The Home tab keeps its own stack, so the tab bar stays visible on the
 * screens opened from Home (FA04, FA07, FA08, FA10–FA11, FA14, FA17, FA18),
 * as in their designs. Home (FA03) is always underneath, so back returns to it.
 */
export const unstable_settings = { anchor: 'index' };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
