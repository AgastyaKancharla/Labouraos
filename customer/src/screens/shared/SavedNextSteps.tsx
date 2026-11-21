import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { RegisterResult } from '@/api/types';
import { Banner, Button, Card, Text } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';

/**
 * Shown after a registration form is saved: the new ID (or "We found your
 * registration JS-1234" when the number already had one), what the next
 * steps ask for, and Continue (the steps in the app) / Later.
 */
export function SavedNextSteps({ result, purpose, nextSteps, testID }: { result: RegisterResult; purpose: 'registration' | 'referral_registration' | 'business_agreement'; nextSteps: string; testID?: string }) {
  const { t } = useI18n();
  const code = result.profile.code ?? '';
  return (
    <View style={styles.gap} testID={testID}>
      {result.existing ? (
        <Banner tone="info" title={t('saved.foundTitle')} message={t('saved.found', { code })} testID={`${testID}-existing`} />
      ) : (
        <Banner tone="ok" title={t('saved.title')} message={code ? t('saved.yourId', { code }) : undefined} testID={`${testID}-new`} />
      )}
      <Card title={t('saved.next')} accent="cyan" emoji="👉">
        <View style={styles.gap}>
          <Text>{nextSteps}</Text>
          <Text variant="muted">{t('saved.secureNote')}</Text>
          <Button
            label={t('common.continue')}
            onPress={() => router.replace(routes.verify(purpose, result.profile.id))}
            testID={`${testID}-continue`}
          />
          <Button label={t('saved.later')} variant="secondary" onPress={() => router.replace(routes.home)} testID={`${testID}-later`} />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 } });
