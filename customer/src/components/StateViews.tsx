import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';
import { isApiError } from '@/api/errors';
import { colors } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';

/** Spinner with "Loading…" — for a whole screen or a card. */
export function LoadingState({ label, compact }: { label?: string; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <View style={[styles.box, compact && styles.compact]} accessibilityRole="progressbar" accessibilityLabel={label ?? t('common.loading')}>
      <ActivityIndicator color={colors.blue} />
      <Text variant="muted">{label ?? t('common.loading')}</Text>
    </View>
  );
}

/** Friendly error with a retry button. Network errors say "no signal". */
export function ErrorState({ error, onRetry, compact }: { error?: unknown; onRetry?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const message = isApiError(error) && error.isNetworkError ? t('common.networkError') : t('common.error');
  return (
    <View style={[styles.box, compact && styles.compact]} accessibilityRole="alert">
      <Text variant="bodyStrong" color={colors.tomato} align="center">
        {message}
      </Text>
      {onRetry ? <Button label={t('common.retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** Nothing to show yet. */
export function EmptyState({ title, message, compact }: { title?: string; message?: string; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <View style={[styles.box, compact && styles.compact]}>
      {title ? (
        <Text variant="h2" align="center">
          {title}
        </Text>
      ) : null}
      <Text variant="muted" align="center">
        {message ?? t('common.empty')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 32, paddingHorizontal: 16 },
  compact: { paddingVertical: 12 },
});
