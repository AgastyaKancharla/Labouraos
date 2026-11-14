import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components';
import { routes } from '@/navigation/routes';

/**
 * Where to start: signed out → language and sign-in; signed in without a
 * verified phone → "Your mobile number"; no profile yet → the role picker;
 * otherwise Home.
 */
export default function Start() {
  const { status, account, accountError, refreshAccount } = useAuth();
  if (status === 'loading') return <LoadingState />;
  if (status === 'signed_out') return <Redirect href={routes.welcome} />;
  if (!account) {
    if (accountError) return <ErrorState error={accountError} onRetry={() => void refreshAccount()} />;
    return <LoadingState />;
  }
  if (!account.phoneVerified) return <Redirect href={routes.verifyPhone} />;
  if (account.profiles.length === 0) return <Redirect href={routes.role} />;
  return <Redirect href={routes.home} />;
}
