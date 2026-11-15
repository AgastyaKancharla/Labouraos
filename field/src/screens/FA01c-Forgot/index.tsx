import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useEndpoints } from '@/api/ApiProvider';
import type { ResetRequestAnswer } from '@/api/endpoints/auth';
import { isApiError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { getDeviceId } from '@/auth/device';
import { Banner, Button, Card, CodeInput, Screen, Text, TextField, TopBar } from '@/components';
import { useI18n } from '@/i18n';
import { formatCountdown } from '@/lib/format';
import { secureStorage } from '@/lib/storage';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';

const MIN_PASSWORD = 8;

/**
 * FA01c — Forgot password (Master Guide rev 174–175). Staff code → "Ask your
 * senior for the reset code" (a red PASSWORD RESET card on their Login codes
 * screen; they call back and read the code out) → reset code + new password
 * typed twice → "Password changed" → sign in. The first answer is the same
 * whether the staff code exists or not. Works once, 15 minutes, this phone only.
 */
export default function ForgotPasswordScreen({ now = Date.now }: { now?: () => number }) {
  const { t } = useI18n();
  const { auth } = useEndpoints();
  const { deviceId } = useAuth();
  const [staffCode, setStaffCode] = useState('');
  const [asked, setAsked] = useState<(ResetRequestAnswer & { deviceId: string }) | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!asked) return;
    const end = new Date(asked.expiresAt).getTime();
    const tick = () => setRemaining(end - now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [asked, now]);

  const message = (err: unknown) => (isApiError(err) && !err.isNetworkError ? err.message : t('common.networkError'));

  async function ask() {
    if (!staffCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const id = deviceId ?? (await getDeviceId(secureStorage));
      const answer = await auth.requestReset(staffCode.trim(), id);
      setAsked({ ...answer, deviceId: id });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function complete(value = code) {
    if (!asked) return;
    setError(null);
    if (value.length !== 6) return;
    if (password.length < MIN_PASSWORD) return setError(t('access.setup.tooShort', { min: MIN_PASSWORD }));
    if (confirm !== password) return setError(t('access.setup.mismatch'));
    setBusy(true);
    try {
      const res = await auth.completeReset({
        resetRequestId: asked.resetRequestId,
        resetRequestProof: asked.resetRequestProof,
        deviceId: asked.deviceId,
        code: value,
        newPassword: password,
        confirmPassword: confirm,
      });
      setDone(res.code);
      setPassword('');
      setConfirm('');
      setCode('');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const expired = Boolean(asked) && remaining <= 0;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar title={t('common.brand')} subtitle={t('common.fieldAgent')} />
      <Screen testID="screen-FA01c">
        <View style={styles.body}>
          {done ? (
            <>
              <Text variant="h1" accessibilityRole="header">
                {t('access.forgot.doneTitle')}
              </Text>
              <Banner tone="ok" message={t('access.forgot.doneBody', { code: done })} testID="reset-done" />
              <Button label={t('access.signIn')} onPress={() => router.replace(routes.login)} fullWidth testID="reset-sign-in" />
            </>
          ) : asked ? (
            <>
              <Text variant="h1" accessibilityRole="header">
                {t('access.forgot.askedTitle')}
              </Text>
              <Text variant="muted">{t('access.forgot.askedBody')}</Text>
              {expired ? (
                <Banner tone="warn" message={t('access.forgot.expired')} testID="reset-expired" />
              ) : (
                <Card stripe accent="gold" style={styles.card}>
                  <CodeInput value={code} onChange={setCode} label={t('access.forgot.code')} length={6} editable={!busy} testID="reset-code" />
                  <Text variant="muted">{t('access.forgot.expiresIn', { time: formatCountdown(remaining) })}</Text>
                  <TextField label={t('access.setup.newPassword')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint={t('access.setup.passwordHint', { min: MIN_PASSWORD })} testID="reset-password" />
                  <TextField label={t('access.setup.confirm')} value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" testID="reset-confirm" />
                  {error ? <Banner tone="error" message={error} testID="reset-error" /> : null}
                  <Button label={t('access.forgot.submit')} loading={busy} disabled={code.length !== 6 || !password || !confirm} onPress={() => void complete()} fullWidth testID="reset-submit" />
                </Card>
              )}
              <Button label={t('access.back')} variant="secondary" onPress={() => router.replace(routes.login)} />
            </>
          ) : (
            <>
              <Text variant="h1" accessibilityRole="header">
                {t('access.forgot.title')}
              </Text>
              <Text variant="muted">{t('access.forgot.body')}</Text>
              <Card stripe accent="royal" style={styles.card}>
                <TextField label={t('fa01.staffCode')} value={staffCode} onChangeText={setStaffCode} autoCapitalize="characters" autoCorrect={false} autoComplete="username" testID="reset-staff-code" />
                {error ? <Banner tone="error" message={error} testID="reset-error" /> : null}
                <Button label={t('access.forgot.send')} loading={busy} disabled={!staffCode.trim()} onPress={() => void ask()} fullWidth testID="reset-ask" />
              </Card>
              <Button label={t('access.back')} variant="secondary" onPress={() => router.replace(routes.login)} />
            </>
          )}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  body: { gap: 16, paddingTop: 20 },
  card: { gap: 16 },
});
