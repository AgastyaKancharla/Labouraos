import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { LoadingState } from '@/components';
import { routes } from '@/navigation/routes';

/** Everything behind sign-in. A signed-out agent is sent to FA01. */
export default function AppLayout() {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingState />;
  if (status === 'signedOut') return <Redirect href={routes.login} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
