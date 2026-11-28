import { StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { apiMode } from '@/api/config';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Button, Card, Screen, Text } from '@/components';
import { languageOption, useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';

/**
 * Settings: the language (28 Nov: six languages, changed here), app version,
 * sign out.
 * Notification switches arrive with the notifications work (Agent C).
 */
export default function Settings() {
  const { t, language } = useI18n();
  const { signOut, status } = useAuth();
  return (
    <View style={styles.flex} testID="settings">
      <AppHeader title={t('settings.title')} onBack={() => router.back()} showAccountActions={status === 'signed_in'} />
      <Screen>
        <Card title={t('language.title')} accent="royal" testID="settings-language">
          <View style={styles.row}>
            <Text variant="bodyStrong" style={styles.flex}>
              {languageOption(language).name}
            </Text>
            <Button label={t('language.change')} variant="secondary" onPress={() => router.push(routes.language)} testID="settings-language-change" />
          </View>
        </Card>
        <Card title={t('settings.about')} accent="navy" emoji="ℹ️">
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

const styles = StyleSheet.create({ flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 } });
