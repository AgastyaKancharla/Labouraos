import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useEndpoints } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Button, Card, Emoji, Screen, Text, TextField, TopBar } from '@/components';
import { LiveCamera, type CapturedPhoto } from '@/device/camera';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';

/** True when the text is the temporary password in another form (any case, with or without the dash). */
export function sameAsTemporary(password: string, temporary: string): boolean {
  const clean = (v: string) => v.replace(/[\s-]/g, '').toUpperCase();
  return Boolean(temporary) && clean(password) === clean(temporary);
}

type Step = 'photo' | 'password' | 'done';

/**
 * FA01b — Set your password (Master Guide rev 174–175). After the staff code
 * and the temporary password: no session, only a 15-minute set-up ticket for
 * this phone. A live front-camera selfie (when none is on file), then a new
 * password typed twice, then "Password set — sign in". Field agents have no
 * authenticator, so there is no QR step here.
 */
export default function SetupScreen() {
  const { t } = useI18n();
  const { auth } = useEndpoints();
  const { pendingSetup, cancelSetup } = useAuth();
  const [chosenStep, setStep] = useState<Step | null>(null);
  // The first step follows the set-up answer (selfie first when no staff photo is on file).
  const step: Step = chosenStep ?? (pendingSetup?.photoRequired ? 'photo' : 'password');
  const [camera, setCamera] = useState(false);
  const [photoDone, setPhotoDone] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [doneCode, setDoneCode] = useState<string | null>(null);

  if (!pendingSetup && !doneCode) return <Redirect href={routes.login} />;

  const fail = (err: unknown) => {
    if (isApiError(err) && err.status === 401) {
      setExpired(true);
      return;
    }
    if (isApiError(err) && !err.isNetworkError) {
      setError(err.message);
      return;
    }
    setError(t('common.networkError'));
  };

  function back() {
    cancelSetup();
    router.replace(routes.login);
  }

  async function savePhoto(photo: CapturedPhoto) {
    if (!pendingSetup) return;
    setCamera(false);
    setBusy(true);
    setError(null);
    try {
      await auth.setupPhoto(pendingSetup.setupTicket, pendingSetup.deviceId, photo);
      setPhotoDone(true);
      setStep('password');
    } catch (err) {
      if (isApiError(err) && err.status === 401) setExpired(true);
      else setError(t('access.setup.photoFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!pendingSetup) return;
    setError(null);
    const min = pendingSetup.passwordRules.minLength;
    if (password.length < min) return setError(t('access.setup.tooShort', { min }));
    if (sameAsTemporary(password, pendingSetup.temporary)) return setError(t('access.setup.sameAsTemp'));
    if (confirm !== password) return setError(t('access.setup.mismatch'));
    setBusy(true);
    try {
      const res = await auth.completeSetup({ setupTicket: pendingSetup.setupTicket, deviceId: pendingSetup.deviceId, newPassword: password, confirmPassword: confirm });
      setPassword('');
      setConfirm('');
      setDoneCode(res.code);
      setStep('done');
      cancelSetup();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  if (camera) {
    return <LiveCamera facing="front" requireLocation={false} onCapture={(photo) => void savePhoto(photo)} onCancel={() => setCamera(false)} />;
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar title={t('common.brand')} subtitle={t('common.fieldAgent')} />
      <Screen testID="screen-FA01b">
        <View style={styles.body}>
          {expired ? (
            <>
              <Text variant="h1" accessibilityRole="header">
                {t('access.setup.title')}
              </Text>
              <Banner tone="warn" message={t('access.setup.expired')} testID="setup-expired" />
              <Button label={t('access.back')} onPress={back} fullWidth testID="setup-back" />
            </>
          ) : step === 'done' ? (
            <>
              <Text variant="h1" accessibilityRole="header">
                {t('access.setup.doneTitle')}
              </Text>
              <Banner tone="ok" message={t('access.setup.doneBody', { code: doneCode ?? '' })} testID="setup-done" />
              <Button label={t('access.signIn')} onPress={() => router.replace(routes.login)} fullWidth testID="setup-sign-in" />
            </>
          ) : step === 'photo' ? (
            <>
              <View style={styles.titleRow}>
                <Text variant="h1" accessibilityRole="header" style={styles.flex1}>
                  {t('access.setup.photoTitle')}
                </Text>
                <Emoji symbol="🤳" size={30} />
              </View>
              <Text variant="muted">{t('access.setup.photoBody')}</Text>
              {error ? <Banner tone="error" message={error} testID="setup-error" /> : null}
              <Button label={busy ? t('access.setup.saving') : t('access.setup.photoOpen')} loading={busy} onPress={() => setCamera(true)} fullWidth testID="setup-photo-open" />
              <Button label={t('access.setup.photoLater')} variant="secondary" onPress={() => setStep('password')} testID="setup-photo-later" />
            </>
          ) : (
            <>
              <Text variant="h1" accessibilityRole="header">
                {t('access.setup.welcome', { name: pendingSetup?.staff.name ?? '' })}
              </Text>
              {photoDone ? <Banner tone="ok" message={t('access.setup.photoDone')} /> : null}
              <Text variant="muted">{t('access.setup.intro')}</Text>
              <Text variant="small">{t('access.setup.staffCode', { code: pendingSetup?.staff.code ?? '' })}</Text>
              <Card stripe accent="royal" style={styles.card}>
                <TextField
                  label={t('access.setup.newPassword')}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  hint={t('access.setup.passwordHint', { min: pendingSetup?.passwordRules.minLength ?? 8 })}
                  testID="setup-password"
                />
                <TextField label={t('access.setup.confirm')} value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" testID="setup-confirm" />
                {error ? <Banner tone="error" message={error} testID="setup-error" /> : null}
                <Button label={busy ? t('access.setup.saving') : t('access.setup.finish')} loading={busy} onPress={() => void submit()} fullWidth testID="setup-finish" />
              </Card>
              <Button label={t('access.back')} variant="secondary" onPress={back} />
            </>
          )}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  body: { gap: 16, paddingTop: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { gap: 16 },
});
