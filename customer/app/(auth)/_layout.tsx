import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';

/** Language and sign-in. A signed-in person is sent on to the app. */
export default function AuthLayout() {
  const { status } = useAuth();
  if (status === 'signed_in') return <Redirect href={routes.start} />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
