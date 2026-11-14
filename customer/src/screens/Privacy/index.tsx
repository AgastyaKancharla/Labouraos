import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Button, Card, Screen, Text } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';

/** The public privacy policy page (proposal 8.3: on laboura.com). Overridable per build. */
export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL || 'https://laboura.com/privacy';

/**
 * Privacy (proposal 7.1, 7.4): what the app collects and why, the grievance
 * contact (from the server), the privacy policy, and "Delete my account" —
 * required inside the app by both stores.
 */
export default function Privacy() {
  const { t } = useI18n();
  const { account } = useAuth();
  return (
    <View style={styles.flex} testID="privacy">
      <AppHeader title={t('privacy.title')} onBack={() => router.back()} showAccountActions />
      <Screen>
        <Card title={t('privacy.whatTitle')}>
          <View style={styles.gap}>
            <Text>{t('privacy.what')}</Text>
            <Text>{t('privacy.never')}</Text>
            <Text>{t('privacy.consents')}</Text>
          </View>
        </Card>
        <Card title={t('privacy.grievanceTitle')}>
          <Text testID="privacy-grievance">{account?.grievanceContact || t('privacy.grievanceFallback')}</Text>
        </Card>
        <Button label={t('privacy.policy')} variant="secondary" onPress={() => void Linking.openURL(PRIVACY_URL)} testID="privacy-policy" />
        <Button label={t('privacy.delete')} variant="danger" onPress={() => router.push(routes.deleteAccount)} testID="privacy-delete" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 10 } });
