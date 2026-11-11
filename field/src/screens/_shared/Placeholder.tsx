import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Screen, Text } from '@/components';
import { useI18n, type MessageKey } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from './AppHeader';

interface Props {
  /** Design id, e.g. "FA05-Visits". */
  design: string;
  titleKey: MessageKey;
  /** Inside the tab bar (no "Go to Home" button needed). */
  inTabs?: boolean;
}

/**
 * Stand-in for a screen that a later wave builds. Replace the route file's
 * export with the real screen from src/screens/<design>/.
 */
export function Placeholder({ design, titleKey, inTabs }: Props) {
  const { t } = useI18n();
  return (
    <View style={styles.flex} testID={`placeholder-${design}`}>
      <AppHeader title={t(titleKey)} />
      <Screen>
        <Card>
          <Text variant="h2">{t('placeholder.title')}</Text>
          <Text variant="muted" style={styles.body}>
            {t('placeholder.body', { design })}
          </Text>
        </Card>
        {!inTabs ? <Button label={t('notFound.back')} variant="secondary" onPress={() => router.replace(routes.home)} /> : null}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  body: { marginTop: 6 },
});
