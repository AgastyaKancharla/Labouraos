import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { accents, colors, radius, type Accent } from '@/theme';
import { IconTile } from './IconTile';
import type { IconName } from './Icon';
import { Text } from './Text';

export type BannerTone = 'warn' | 'ok' | 'error' | 'info';

interface Props {
  tone?: BannerTone;
  title?: string;
  message?: string;
  /** Right side, e.g. the green Login button on FA03. */
  action?: ReactNode;
  /** Override the drawn icon in the coloured round tile (each tone has its own). */
  icon?: IconName;
  /** Hide the icon tile (very small boxes inside cards). */
  plain?: boolean;
  testID?: string;
}

/**
 * `.warn` (amber), `.ok` (green), error (red) and info (blue) boxes, each
 * with a coloured bar down the left edge and a drawn icon in a round tile of
 * the same raw brand colour (drawn, so it adds no text). The words stay in
 * the readable colours.
 */
export function Banner({ tone = 'warn', title, message, action, icon, plain, testID }: Props) {
  const t = toneStyles[tone];
  const accent = accents[t.accent];
  return (
    <View
      style={[styles.box, t.box, { borderLeftColor: accent.raw }]}
      testID={testID}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
    >
      {plain ? null : <IconTile icon={icon ?? t.icon} accent={t.accent} size={30} />}
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
    borderLeftWidth: 4,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 14,
  },
  text: { flex: 1, gap: 2 },
});

const toneStyles: Record<BannerTone, { box: { backgroundColor: string; borderColor: string }; title: string; accent: Accent; icon: IconName }> = {
  warn: { box: { backgroundColor: colors.amber100, borderColor: colors.amberBorder }, title: colors.ink, accent: 'gold', icon: 'alert' },
  ok: { box: { backgroundColor: colors.green100, borderColor: 'rgba(28,154,108,0.35)' }, title: colors.greenText, accent: 'green', icon: 'check' },
  error: { box: { backgroundColor: colors.tomato100, borderColor: 'rgba(187,35,43,0.35)' }, title: colors.tomato, accent: 'red', icon: 'alert' },
  info: { box: { backgroundColor: colors.blue100, borderColor: '#BCD3F3' }, title: colors.navy, accent: 'royal', icon: 'bell' },
};
