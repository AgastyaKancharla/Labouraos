import { Stack } from 'expo-router';

/**
 * The Me tab: targets and leaderboard, my attendance, leave, corrections, payslips, language and log out.
 * The main page (index) is always underneath, so back returns to it even when a
 * screen is opened straight from its URL.
 */
export const unstable_settings = { anchor: 'index' };

export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
