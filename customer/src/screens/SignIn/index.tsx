import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomerApi } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import { appleSignIn, appleSignInAvailable } from '@/auth/apple';
import { useAuth } from '@/auth/AuthProvider';
import { googleSignIn } from '@/auth/google';
import { AppHeader, Banner, Button, Card, Screen, Text } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';

/**
 * Sign-in (decision D2): "Continue with Google" or "Continue with mobile
 * number", and "Sign in with Apple" on iPhone (Apple rule 4.8). Either way
 * the mobile number is verified before any profile is registered.
 */
export default function SignIn() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { completeSignIn, signedOutReason } = useAuth();
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apple, setApple] = useState(false);

  useEffect(() => {
    let live = true;
    void appleSignInAvailable().then((ok) => live && setApple(ok));
    return () => {
      live = false;
    };
  }, []);

  const finish = async (call: () => Promise<Parameters<typeof completeSignIn>[0]>) => {
    try {
      await completeSignIn(await call());
      router.replace(routes.start);
    } catch (err) {
      setError(isApiError(err) && err.isNetworkError ? t('common.networkError') : t('signIn.failed'));
    }
  };

  const onGoogle = async () => {
    setBusy('google');
    setError(null);
    const result = await googleSignIn();
    if (result.status === 'ok') await finish(() => api.signInWithGoogle(result.idToken));
    else if (result.status === 'unavailable') setError(t(`signIn.google.${result.reason}`));
    else if (result.status === 'error') setError(t('signIn.failed'));
    setBusy(null);
  };

  const onApple = async () => {
    setBusy('apple');
    setError(null);
    const result = await appleSignIn();
    if (result.status === 'ok') await finish(() => api.signInWithApple({ identityToken: result.identityToken, fullName: result.fullName }));
    else if (result.status === 'error') setError(t('signIn.failed'));
    setBusy(null);
  };

  return (
    <View style={styles.flex} testID="sign-in">
      <AppHeader title={t('signIn.title')} />
      <Screen>
        {signedOutReason === 'expired' ? <Banner tone="info" message={t('signIn.expired')} testID="sign-in-expired" /> : null}
        {signedOutReason === 'deleted' ? <Banner tone="ok" message={t('signIn.deleted')} testID="sign-in-deleted" /> : null}
        <Card>
          <View style={styles.gap}>
            <Text variant="h2">{t('signIn.heading')}</Text>
            <Text variant="muted">{t('signIn.why')}</Text>
            <Button label={t('signIn.google')} variant="secondary" onPress={() => void onGoogle()} loading={busy === 'google'} disabled={busy !== null} testID="sign-in-google" />
            {apple ? (
              <Button label={t('signIn.apple')} variant="navy" onPress={() => void onApple()} loading={busy === 'apple'} disabled={busy !== null} testID="sign-in-apple" />
            ) : null}
            <Button label={t('signIn.mobile')} onPress={() => router.push(routes.signInPhone)} disabled={busy !== null} testID="sign-in-mobile" />
          </View>
        </Card>
        {error ? <Banner tone="error" message={error} testID="sign-in-error" /> : null}
        <Text variant="muted" align="center">
          {t('signIn.agree')}
        </Text>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 12 },
});
