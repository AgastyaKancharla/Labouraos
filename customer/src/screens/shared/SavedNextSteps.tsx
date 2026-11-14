import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { RegisterResult, SheetPurpose } from '@/api/types';
import { Banner, Button, Card, Text } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { useSecureSheet } from './useSecureSheet';

/**
 * Shown after a registration form is saved: the new ID (or "We found your
 * registration JS-1234" when the number already had one), what the secure
 * page will ask for next, and Continue / Later.
 */
export function SavedNextSteps({ result, purpose, nextSteps, testID }: { result: RegisterResult; purpose: SheetPurpose; nextSteps: string; testID?: string }) {
  const { t } = useI18n();
  const sheet = useSecureSheet();
  const code = result.profile.code ?? '';
  return (
    <View style={styles.gap} testID={testID}>
      {result.existing ? (
        <Banner tone="info" title={t('saved.foundTitle')} message={t('saved.found', { code })} testID={`${testID}-existing`} />
      ) : (
        <Banner tone="ok" title={t('saved.title')} message={code ? t('saved.yourId', { code }) : undefined} testID={`${testID}-new`} />
      )}
      <Card title={t('saved.next')}>
        <View style={styles.gap}>
          <Text>{nextSteps}</Text>
          <Text variant="muted">{t('saved.secureNote')}</Text>
          <Button
            label={t('common.continue')}
            loading={sheet.busy}
            onPress={async () => {
              const outcome = await sheet.open(result.profile.id, purpose);
              if (outcome) router.replace(routes.home);
            }}
            testID={`${testID}-continue`}
          />
          <Button label={t('saved.later')} variant="secondary" onPress={() => router.replace(routes.home)} testID={`${testID}-later`} />
        </View>
      </Card>
      {sheet.error ? <Banner tone="error" message={sheet.error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 } });
