import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import type { OtpProof } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, LoadingState, Screen, Text } from '@/components';
import { Checkbox } from '@/components/form';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { OtpCodeCard } from '../shared/OtpCodeCard';

/**
 * "Delete my account" (proposal 7.1, 7.4; C20; contract 11). The server says
 * first whether a job seeker's ₹499 guarantee is running (GET /me/deletion):
 * deleting then is the same as withdrawing consent after paying, which ends
 * the refund (decided 7 Nov, question 20) — the app says so in large words
 * and needs a tick. A fresh OTP is always asked (step-up "delete_account").
 * What the law makes Laboura keep is listed.
 */
export default function DeleteAccount() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { account, signOut } = useAuth();
  const info = useQuery({ queryKey: ['deletion-info'], queryFn: () => api.deletionInfo(), retry: 1 });
  // If the server cannot say, assume a paid job seeker may lose the refund.
  const fallbackRisk = (account?.profiles ?? []).some((p) => p.kind === 'job_seeker' && (p.stage === 'payment' || p.stage === 'active' || p.stage === undefined));
  const guaranteeAtRisk = info.data ? info.data.guaranteeRunning : info.isError ? fallbackRisk : false;
  const [accepted, setAccepted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const blocked = guaranteeAtRisk && !accepted;
  const kept = info.data?.kept ?? ['payments', 'invoices'];

  if (done) {
    return (
      <View style={styles.flex} testID="delete-done">
        <AppHeader title={t('delete.title')} />
        <Screen>
          <Banner tone="ok" title={t('delete.doneTitle')} message={t('delete.done')} />
          <Card title={t('delete.keptTitle')}>
            {kept.map((item) => (
              <Text key={item}>• {t(`kept.${item}`)}</Text>
            ))}
          </Card>
          <Button label={t('common.close')} onPress={() => void signOut('deleted').then(() => router.replace(routes.signIn))} testID="delete-close" />
        </Screen>
      </View>
    );
  }

  const submit = async (otp: OtpProof) => {
    setProblem(null);
    try {
      await api.requestDeletion({ otp, acceptGuaranteeLoss: accepted });
      setDone(true);
    } catch (e) {
      if (isApiError(e) && e.code === 'GUARANTEE_WARNING_REQUIRED') {
        setProblem(t('delete.guarantee'));
        void info.refetch();
        return;
      }
      throw e;
    }
  };

  return (
    <View style={styles.flex} testID="delete-account">
      <AppHeader title={t('delete.title')} onBack={() => router.back()} />
      <Screen>
        {info.isLoading ? <LoadingState compact /> : null}
        {info.data?.openRequest ? <Banner tone="info" message={t('error.deletionPending')} testID="delete-open-request" /> : null}
        {guaranteeAtRisk ? (
          <View style={styles.gap} testID="delete-guarantee-warning">
            <Banner tone="error" title={t('delete.guaranteeTitle')} message={t('delete.guarantee')} />
            <Checkbox label={t('delete.guaranteeTick')} checked={accepted} onChange={setAccepted} testID="delete-accept" />
          </View>
        ) : null}
        <Card>
          <View style={styles.gap}>
            <Text>{t('delete.what')}</Text>
            <Text variant="muted">{t('delete.keptNote')}</Text>
            <OtpCodeCard
              testID="delete-otp"
              disabled={blocked || info.isLoading || !!info.data?.openRequest}
              send={(resendOf) => api.sendStepUp('delete_account', resendOf)}
              submit={submit}
              sendLabel={t('delete.sendOtp', { last4: account?.phoneLast4 ?? '' })}
              submitLabel={t('delete.confirm')}
              sentText={t('otp.sentTo', { last4: account?.phoneLast4 ?? '' })}
            />
          </View>
        </Card>
        {problem ? <Banner tone="error" message={problem} testID="delete-problem" /> : null}
        <Button label={t('common.cancel')} variant="secondary" onPress={() => router.back()} testID="delete-cancel" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 12 } });
