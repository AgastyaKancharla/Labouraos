import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomerApi } from '@/api/ApiProvider';
import type { PhoneVerified } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, Screen, Text } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { PhoneOtpForm } from '../shared/PhoneOtpForm';

/**
 * After Google or Apple: "Your mobile number" with an OTP, BEFORE any
 * profile (proposal 3, owner-confirmed). Laboura's records, calls and
 * guarantees all run on the phone number. If the number already belongs to
 * someone an agent registered, the account joins that record — never a
 * second one — and says "We found your registration JS-1234".
 */
export default function VerifyPhone() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { setAccount, account, signOut } = useAuth();
  const [done, setDone] = useState<PhoneVerified | null>(null);

  if (done) {
    return (
      <View style={styles.flex} testID="verify-phone-done">
        <AppHeader title={t('verifyPhone.title')} />
        <Screen>
          <Banner tone="ok" title={t('verifyPhone.verified')} message={t('verifyPhone.verifiedMessage')} />
          {(done.linkedExisting ?? []).map((link) => (
            <Banner key={link.code} tone="info" message={t('verifyPhone.foundExisting', { code: link.code })} testID={`verify-phone-found-${link.code}`} />
          ))}
          <Button label={t('common.continue')} onPress={() => router.replace(routes.start)} testID="verify-phone-continue" />
        </Screen>
      </View>
    );
  }

  return (
    <View style={styles.flex} testID="verify-phone">
      <AppHeader title={t('verifyPhone.title')} />
      <Screen>
        <Card>
          <View style={styles.gap}>
            {account?.name ? <Text variant="h2">{t('verifyPhone.hello', { name: account.name.split(' ')[0] })}</Text> : null}
            <Text>{t('verifyPhone.why')}</Text>
            <PhoneOtpForm
              testID="verify-otp"
              send={(phone, contactConsent) => api.sendPhoneOtp({ phone, contactConsent })}
              verify={async ({ requestId, code }) => {
                const result = await api.verifyPhoneOtp({ requestId, code });
                setAccount(result.account);
                setDone(result);
              }}
            />
          </View>
        </Card>
        <Button
          label={t('menu.signOut')}
          variant="secondary"
          onPress={() => void signOut().then(() => router.replace(routes.signIn))}
          testID="verify-phone-sign-out"
        />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 12 } });
