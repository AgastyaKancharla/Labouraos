import { StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCustomerApi } from '@/api/ApiProvider';
import { apiMode } from '@/api/config';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Button, Card, Screen, Text } from '@/components';
import { RadioGroup } from '@/components/form';
import { LANGUAGES, useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';

/**
 * Settings: app language (Kannada, Hindi, English — also saved to the
 * account so messages come in the same language), app version, sign out.
 * Notification switches arrive with the notifications work (Agent C).
 */
export default function Settings() {
  const { t, language, setLanguage } = useI18n();
  const api = useCustomerApi();
  const { setAccount, signOut, status } = useAuth();
  return (
    <View style={styles.flex} testID="settings">
      <AppHeader title={t('settings.title')} onBack={() => router.back()} showAccountActions={status === 'signed_in'} />
      <Screen>
        <Card title={t('settings.language')}>
          <RadioGroup
            value={language}
            onChange={(code) => {
              setLanguage(code);
              if (status === 'signed_in') void api.setLanguage(code).then(setAccount).catch(() => undefined);
            }}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label === 'EN' ? 'English' : l.label }))}
            testID="settings-language"
          />
        </Card>
        <Card title={t('settings.about')}>
          <Text testID="settings-version">{t('settings.version', { version: Constants.expoConfig?.version ?? '—' })}</Text>
          {apiMode() === 'mock' ? <Text variant="muted">{t('settings.mockMode')}</Text> : null}
        </Card>
        {status === 'signed_in' ? (
          <Button label={t('menu.signOut')} variant="danger" onPress={() => void signOut().then(() => router.replace(routes.signIn))} testID="settings-sign-out" />
        ) : null}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
