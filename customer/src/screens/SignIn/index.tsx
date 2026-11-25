import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomerApi } from '@/api/ApiProvider';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Card, Screen, Text } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { PhoneOtpForm } from '../shared/PhoneOtpForm';

/**
 * Sign-in (owner, 24 Nov): the mobile number is the only way in — no Google
 * or Apple button. The number is checked by OTP on this screen and the
 * account starts.
 */
export default function SignIn() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { completeSignIn, signedOutReason } = useAuth();
  return (
    <View style={styles.flex} testID="sign-in">
      <AppHeader title={t('signIn.title')} />
      <Screen>
        {signedOutReason === 'expired' ? <Banner tone="info" message={t('signIn.expired')} testID="sign-in-expired" /> : null}
        {signedOutReason === 'deleted' ? <Banner tone="ok" message={t('signIn.deleted')} testID="sign-in-deleted" /> : null}
        <Card accent="royal">
          <View style={styles.gap} testID="sign-in-phone">
            <Text variant="h2">{t('signIn.heading')}</Text>
            <Text variant="muted">{t('signIn.mobileWhy')}</Text>
            <PhoneOtpForm
              send={(phone, _consent, resendOf) => api.sendSignInOtp(phone, resendOf)}
              verify={async (input) => {
                await completeSignIn(await api.verifySignInOtp(input));
                router.replace(routes.start);
              }}
            />
          </View>
        </Card>
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
