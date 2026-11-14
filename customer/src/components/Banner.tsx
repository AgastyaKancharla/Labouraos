import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '@/theme';
import { Text } from './Text';

export type BannerTone = 'warn' | 'ok' | 'error' | 'info';

interface Props {
  tone?: BannerTone;
  title?: string;
  message?: string;
  /** Right side, e.g. the green Login button on FA03. */
  action?: ReactNode;
  testID?: string;
}

/** `.warn` (amber), `.ok` (green), error (red) and info (blue) boxes. */
export function Banner({ tone = 'warn', title, message, action, testID }: Props) {
  const t = toneStyles[tone];
  return (
    <View style={[styles.box, t.box]} testID={testID} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      <View style={styles.text}>
        {title ? (
          <Text variant="bodyStrong" color={t.title}>
            {title}
          </Text>
        ) : null}
        {message ? <Text variant="small">{message}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  text: { flex: 1, gap: 2 },
});

const toneStyles = {
  warn: { box: { backgroundColor: colors.amber100, borderColor: colors.amberBorder }, title: colors.ink },
  ok: { box: { backgroundColor: colors.green100, borderColor: 'rgba(28,154,108,0.35)' }, title: colors.green },
  error: { box: { backgroundColor: colors.tomato100, borderColor: 'rgba(187,35,43,0.35)' }, title: colors.tomato },
  info: { box: { backgroundColor: colors.blue100, borderColor: '#BCD3F3' }, title: colors.navy },
} as const;
