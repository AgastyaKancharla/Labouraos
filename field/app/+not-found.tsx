import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Screen, Text, TopBar } from '@/components';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <View style={styles.flex}>
      <TopBar title={t('common.appName')} />
      <Screen>
        <Text variant="h1">{t('notFound.title')}</Text>
        <Button label={t('notFound.back')} onPress={() => router.replace(routes.home)} />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1, backgroundColor: colors.bg } });
