import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { LoadingState } from '@/components';
import { routes } from '@/navigation/routes';

/** Sign-in screens. A signed-in agent is sent to Home. */
export default function AuthLayout() {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingState />;
  if (status === 'signedIn') return <Redirect href={routes.home} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
