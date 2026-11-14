import { Redirect, Stack, usePathname } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components';
import { routes } from '@/navigation/routes';
import { PushBridge } from '@/push';
import { colors } from '@/theme';

/** Screens a Google / Apple account may open before its phone is verified. */
const BEFORE_PHONE: string[] = [routes.verifyPhone, routes.settings, routes.privacy, routes.deleteAccount, routes.help];

/**
 * Everything after sign-in. Signed out → sign-in. No verified mobile → the
 * phone step first: no profile is registered without one (proposal 3).
 */
export default function AppLayout() {
  const { status, account, accountError, refreshAccount } = useAuth();
  const pathname = usePathname();
  if (status === 'loading') return <LoadingState />;
  if (status === 'signed_out') return <Redirect href={routes.welcome} />;
  if (!account) {
    if (accountError) return <ErrorState error={accountError} onRetry={() => void refreshAccount()} />;
    return <LoadingState />;
  }
  if (!account.phoneVerified && !BEFORE_PHONE.includes(pathname)) return <Redirect href={routes.verifyPhone} />;
  return (
    <>
      <PushBridge />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </>
  );
}
