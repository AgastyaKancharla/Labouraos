import { StyleSheet, View } from 'react-native';
import { useCustomerApi } from '@/api/ApiProvider';
import type { OtpProof } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Button, Card } from '@/components';
import { useI18n } from '@/i18n';
import { OtpCodeCard } from './OtpCodeCard';

/**
 * The last step of every registration form (contract 3.6 and 5): a fresh
 * code to the account's own verified mobile (step-up purpose "register"),
 * sent inside the registration — the existing job seeker, business and
 * referral services need an OTP-verified mobile for every record, and the
 * code is used up by it (one code, one record).
 */
export function RegisterOtpStep({ submit, onBack, testID }: { submit: (otp: OtpProof) => Promise<void>; onBack: () => void; testID: string }) {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { account } = useAuth();
  const last4 = account?.phoneLast4 ?? '';
  return (
    <View style={styles.gap} testID={testID}>
      <Banner tone="info" title={t('register.otpTitle')} message={t('register.otpWhy')} />
      <Card>
        <OtpCodeCard
          testID={`${testID}-otp`}
          send={(resendOf) => api.sendStepUp('register', resendOf)}
          submit={submit}
          sendLabel={t('register.sendOtp', { last4 })}
          submitLabel={t('register.submit')}
          sentText={t('otp.sentTo', { last4 })}
        />
      </Card>
      <Button label={t('register.edit')} variant="secondary" onPress={onBack} testID={`${testID}-back`} />
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 } });
