import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomerApi } from '@/api/ApiProvider';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Card, Screen, Text } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { PhoneOtpForm } from '../shared/PhoneOtpForm';

/** "Continue with mobile number": the number is verified on the spot and the account starts. */
export default function SignInPhone() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { completeSignIn } = useAuth();
  return (
    <View style={styles.flex} testID="sign-in-phone">
      <AppHeader title={t('signIn.mobileTitle')} onBack={() => router.back()} />
      <Screen>
        <Card>
          <View style={styles.gap}>
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
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 12 } });
