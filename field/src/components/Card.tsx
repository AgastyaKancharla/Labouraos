import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { accents, colors, radius, shadow, type Accent } from '@/theme';
import { IconTile } from './IconTile';
import type { IconName } from './Icon';
import { Text } from './Text';

interface Props extends ViewProps {
  /** Small upper-case heading (`.lbl`), e.g. "Today", "Alerts". */
  title?: string;
  compact?: boolean;
  /** A drawn icon in a coloured round tile beside the title (Command Center panel heading). */
  icon?: IconName;
  /** Or a friendly emoji picture beside the title. */
  emoji?: string;
  /** The colour of the icon tile and of the stripe. */
  accent?: Accent;
  /** A coloured bar down the left edge — a calm section accent for forms and steps. */
  stripe?: boolean;
  /** Right side of the title row, e.g. a StatusChip. */
  titleRight?: ReactNode;
}

/** `.card`: white, 16 px corners, thin border; optionally a coloured title tile and a left stripe. */
export function Card({ title, compact, icon, emoji, accent = 'royal', stripe, titleRight, style, children, ...rest }: Props) {
  const hasTile = !!(icon || emoji);
  return (
    <View
      style={[styles.card, compact && styles.compact, stripe && { borderLeftWidth: 4, borderLeftColor: accents[accent].raw }, style]}
      {...rest}
    >
      {title ? (
        <View style={[styles.titleRow, hasTile && styles.titleRowTile]}>
          {hasTile ? <IconTile icon={icon} emoji={emoji} accent={accent} size={30} /> : null}
          <Text variant="label" style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {titleRight}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingVertical: 16,
    paddingHorizontal: 16,
    ...shadow.card,
  },
  compact: { paddingVertical: 12, paddingHorizontal: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  titleRowTile: { marginBottom: 8 },
  title: { flex: 1 },
});
