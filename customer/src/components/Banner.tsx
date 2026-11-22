import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme';
import { Icon, type IconName } from './Icon';
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

/**
 * `.warn` (amber), `.ok` (green), error (red) and info (blue) boxes.
 * Version 2: rounded boxes with a small drawn icon instead of a left stripe.
 * The words stay in the readable colours.
 */
export function Banner({ tone = 'warn', title, message, action, testID }: Props) {
  const t = toneStyles[tone];
  return (
    <View style={[styles.box, t.box]} testID={testID} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      <View style={styles.icon}>
        <Icon name={t.icon} size={19} color={t.iconColor} />
      </View>
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  icon: { paddingTop: 2 },
  text: { flex: 1, gap: 2, alignSelf: 'center' },
});

const toneStyles: Record<BannerTone, { box: object; title: string; icon: IconName; iconColor: string }> = {
  warn: { box: { backgroundColor: colors.amber100, borderColor: colors.amberBorder }, title: colors.ink, icon: 'clock', iconColor: colors.amber },
  ok: { box: { backgroundColor: colors.green100, borderColor: 'rgba(28,154,108,0.35)' }, title: colors.green, icon: 'check', iconColor: colors.green },
  error: { box: { backgroundColor: colors.tomato100, borderColor: 'rgba(187,35,43,0.35)' }, title: colors.tomato, icon: 'info', iconColor: colors.tomato },
  info: { box: { backgroundColor: colors.blue100, borderColor: '#BCD3F3' }, title: colors.navy, icon: 'info', iconColor: colors.blue },
};
