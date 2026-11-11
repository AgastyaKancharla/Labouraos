import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Banner, Button, CodeInput, Screen, Text, TopBar } from '@/components';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, type MessageKey } from '@/i18n';
import { formatCountdown } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { codeErrorKey } from '../FA01-Login/messages';

const CODE_LENGTH = 6;

/**
 * FA02 — Login code. The Team Lead sees the request on their Login codes
 * screen and reads the 6-digit code out over the phone. Works once, for
 * this phone, for 5 minutes.
 */
export default function LoginCodeScreen({ now = Date.now }: { now?: () => number }) {
  const { t } = useI18n();
  const { pendingLogin, verifyCode, cancelPendingLogin } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [remaining, setRemaining] = useState(() =>
    pendingLogin ? new Date(pendingLogin.expiresAt).getTime() - now() : 0,
  );

  useEffect(() => {
    if (!pendingLogin) return;
    const expires = new Date(pendingLogin.expiresAt).getTime();
    const tick = () => setRemaining(expires - now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pendingLogin, now]);

  if (!pendingLogin) return <Redirect href={routes.login} />;

  const expired = remaining <= 0;

  async function submit(value = code) {
    if (value.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await verifyCode(value);
      router.replace(routes.home);
    } catch (error) {
      setErrorKey(codeErrorKey(error));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  function startAgain() {
    cancelPendingLogin();
    router.replace(routes.login);
  }

  return (
    <View style={styles.flex}>
      <TopBar title={t('common.brand')} subtitle={t('common.fieldAgent')} />
      <Screen testID="screen-FA02">
        <View style={styles.body}>
          <Text variant="h1" accessibilityRole="header">
            {t('fa02.title')}
          </Text>
          <Text variant="muted">{t('fa02.help')}</Text>
          <CodeInput
            value={code}
            onChange={setCode}
            onComplete={(value) => void submit(value)}
            label={t('fa02.codeLabel')}
            length={CODE_LENGTH}
            autoFocus
            editable={!expired && !busy}
            testID="login-code"
          />
          {errorKey ? <Banner tone="error" message={t(errorKey)} testID="code-error" /> : null}
          {expired ? (
            <>
              <Banner tone="warn" message={t('fa02.expired')} testID="code-expired" />
              <Button label={t('fa02.startAgain')} onPress={startAgain} fullWidth testID="start-again" />
            </>
          ) : (
            <>
              <Button
                label={busy ? t('fa02.verifying') : t('common.continue')}
                onPress={() => void submit()}
                loading={busy}
                disabled={code.length !== CODE_LENGTH}
                fullWidth
                testID="continue"
              />
              <Text variant="muted">
                {t('fa02.once')} {t('fa02.expiresIn', { time: formatCountdown(remaining) })}
              </Text>
              <Button label={t('fa02.startAgain')} variant="secondary" onPress={startAgain} />
            </>
          )}
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  body: { gap: 16, paddingTop: 20 },
});
