import { StyleSheet, View } from 'react-native';
import { ProgressBar, Text } from '@/components';
import { useI18n } from '@/i18n';

/** "Step 2 of 4 · Selfie" with a bar, above each step. */
export function StepHeader({ current, total, label, title }: { current: number; total: number; label: string; title: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.gap} testID={`step-${current}`}>
      <Text variant="small">{t('verify.step', { current, total, label })}</Text>
      <ProgressBar value={current / total} />
      <Text variant="h1">{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 8 } });
