import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomerApi } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import type { OtpSent } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, CodeInput, Screen, Text } from '@/components';
import { Checkbox } from '@/components/form';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';

/**
 * "Delete my account" (proposal 7.1, 7.4; C20). A fresh OTP is always asked.
 * While a job seeker's ₹499 guarantee may be running, deleting is the same
 * as withdrawing consent after paying, which ends the refund (decided 7 Nov,
 * question 20): the app says so in large words and needs a tick first.
 * What the law makes Laboura keep (payments, invoices) is listed after.
 */
export default function DeleteAccount() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const { account, signOut } = useAuth();
  const guaranteeAtRisk = (account?.profiles ?? []).some((p) => p.kind === 'job_seeker' && (p.stage === 'payment' || p.stage === 'active'));
  const [accepted, setAccepted] = useState(false);
  const [otp, setOtp] = useState<OtpSent | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [kept, setKept] = useState<string[] | null>(null);
  const blocked = guaranteeAtRisk && !accepted;
  const failure = (e: unknown) => setProblem(isApiError(e) ? (e.isNetworkError ? t('common.networkError') : e.message) : t('common.error'));

  if (kept) {
    return (
      <View style={styles.flex} testID="delete-done">
        <AppHeader title={t('delete.title')} />
        <Screen>
          <Banner tone="ok" title={t('delete.doneTitle')} message={t('delete.done')} />
          {kept.length > 0 ? (
            <Card title={t('delete.keptTitle')}>
              {kept.map((line) => (
                <Text key={line}>• {line}</Text>
              ))}
            </Card>
          ) : null}
          <Button
            label={t('common.close')}
            onPress={() => void signOut('deleted').then(() => router.replace(routes.signIn))}
            testID="delete-close"
          />
        </Screen>
      </View>
    );
  }

  return (
    <View style={styles.flex} testID="delete-account">
      <AppHeader title={t('delete.title')} onBack={() => router.back()} />
      <Screen>
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
            {!otp ? (
              <Button
                label={t('delete.sendOtp', { last4: account?.phoneLast4 ?? '' })}
                variant="danger"
                disabled={blocked || busy}
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  setProblem(null);
                  try {
                    setOtp(await api.sendDeletionOtp());
                  } catch (e) {
                    failure(e);
                  } finally {
                    setBusy(false);
                  }
                }}
                testID="delete-send-otp"
              />
            ) : (
              <>
                <CodeInput label={t('otp.code')} value={code} onChange={setCode} autoFocus testID="delete-code" />
                <Button
                  label={t('delete.confirm')}
                  variant="danger"
                  disabled={blocked || code.length !== 6 || busy}
                  loading={busy}
                  onPress={async () => {
                    setBusy(true);
                    setProblem(null);
                    try {
                      const result = await api.requestDeletion({ requestId: otp.requestId, code, acceptGuaranteeLoss: accepted });
                      setKept(result.kept);
                    } catch (e) {
                      failure(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  testID="delete-confirm"
                />
              </>
            )}
          </View>
        </Card>
        {problem ? <Banner tone="error" message={problem} testID="delete-problem" /> : null}
        <Button label={t('common.cancel')} variant="secondary" onPress={() => router.back()} testID="delete-cancel" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 12 } });
