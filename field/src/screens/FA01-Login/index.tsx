import { useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, StyleSheet, View, type TextInputInstance } from 'react-native';
import { router } from 'expo-router';
import { Banner, Button, Screen, Text, TextField, TopBar } from '@/components';
import { useAuth } from '@/auth/AuthProvider';
import { shortDeviceId } from '@/auth/device';
import { isApiError } from '@/api/errors';
import { useI18n, type MessageKey } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors, radius } from '@/theme';
import { loginErrorKey, sessionReasonKey } from './messages';

const logo = require('../../../assets/logo-mark.png');

/**
 * FA01 — Field agent sign in. Staff code + password on the approved phone.
 * Field agents then go to FA02 for the code read out by the Team Lead.
 * Management accounts (Sanket as CEO) are asked for their authenticator code
 * on this same screen instead.
 */
export default function LoginScreen() {
  const { t } = useI18n();
  const { startLogin, signOutReason, deviceId } = useAuth();
  const [staffCode, setStaffCode] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  async function submit() {
    setErrorKey(null);
    setServerMessage(null);
    if (!staffCode.trim() || !password) {
      setErrorKey('fa01.missingFields');
      return;
    }
    setBusy(true);
    try {
      const result = await startLogin(staffCode, password, needsTotp ? totpCode : undefined);
      if (result.kind === 'awaiting_code') router.push(routes.loginCode);
      else router.replace(routes.home);
    } catch (error) {
      const message = isApiError(error) ? error.message : '';
      if (/totp/i.test(message) && /required/i.test(message)) {
        setNeedsTotp(true);
        return;
      }
      const key = loginErrorKey(error);
      setErrorKey(key);
      if (key === 'common.error') setServerMessage(message || null);
    } finally {
      setBusy(false);
    }
  }

  const reasonKey = signOutReason ? sessionReasonKey(signOutReason) : null;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar title={t('common.brand')} subtitle={t('common.fieldAgent')} />
      <Screen testID="screen-FA01">
        <View style={styles.form}>
          <View style={styles.titleRow}>
            <Image source={logo} style={styles.logo} accessibilityIgnoresInvertColors />
            <Text variant="h1" accessibilityRole="header" style={styles.title}>
              {t('fa01.title')}
            </Text>
          </View>
          {reasonKey && !errorKey ? <Banner tone="info" message={t(reasonKey)} testID="session-ended" /> : null}
          <TextField
            label={t('fa01.staffCode')}
            value={staffCode}
            onChangeText={setStaffCode}
            placeholder={t('fa01.staffCodePlaceholder')}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            testID="staff-code"
          />
          <TextField
            ref={passwordRef}
            label={t('fa01.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            testID="password"
          />
          {needsTotp ? (
            <TextField
              label={t('fa01.authenticatorCode')}
              hint={t('fa01.authenticatorHelp')}
              value={totpCode}
              onChangeText={(v) => setTotpCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              inputMode="numeric"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              testID="totp-code"
            />
          ) : null}
          {errorKey ? (
            <Banner
              tone="error"
              message={
                errorKey === 'fa01.devicePending'
                  ? t(errorKey, { device: deviceId ? shortDeviceId(deviceId) : '' })
                  : (serverMessage ?? t(errorKey))
              }
              testID="login-error"
            />
          ) : null}
          <Button
            label={busy ? t('fa01.signingIn') : t('fa01.signIn')}
            onPress={() => void submit()}
            loading={busy}
            fullWidth
            testID="sign-in"
          />
          <Text variant="muted">{t('fa01.approvedPhoneNote')}</Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  form: { gap: 16, paddingTop: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 40, height: 40, borderRadius: radius.md },
  title: { flexShrink: 1 },
});
