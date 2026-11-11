import { Stack } from 'expo-router';

/** The job-seekers tab keeps its own stack, so the tab bar stays visible through the flow. */
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
