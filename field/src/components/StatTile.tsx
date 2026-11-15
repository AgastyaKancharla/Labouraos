import { Children, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, fonts, radius, shadow, statTones, type Accent } from '@/theme';
import { Text } from './Text';

interface Props {
  value: string;
  label: string;
  /** The colour of the short bar on top (Command Center StatTile tones). */
  accent?: Accent;
  /** Extra line under the label. */
  detail?: string;
  onPress?: () => void;
  testID?: string;
}

/**
 * The `.stat` tile: a short coloured bar, a big number and a label. On the
 * green, gold, orange and red tones the number (text-safe colour) and the
 * border take the colour too, exactly like the Command Center.
 */
export function StatTile({ value, label, accent = 'royal', detail, onPress, testID }: Props) {
  const t = statTones[accent];
  const body = (
    <>
      <View style={[styles.bar, { backgroundColor: t.bar }]} />
      <Text style={[styles.value, { color: t.number }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.label}>{label}</Text>
      {detail ? <Text variant="tiny">{detail}</Text> : null}
    </>
  );
  const a11y = { accessible: true, accessibilityLabel: `${value} ${label}`, testID };
  if (onPress) {
    return (
      <Pressable {...a11y} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.tile, { borderColor: t.border }, pressed && styles.pressed]}>
        {body}
      </Pressable>
    );
  }
  return (
    <View {...a11y} style={[styles.tile, { borderColor: t.border }]}>
      {body}
    </View>
  );
}

/** Tiles in rows of `columns` (2 or 3 on a phone); a short last row stretches. */
export function StatGrid({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 }) {
  return (
    <View style={styles.grid}>
      {Children.toArray(children).map((child, i) => (
        <View key={i} style={columns === 2 ? styles.two : styles.three}>
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    alignSelf: 'stretch',
    minWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: colors.surface,
    gap: 2,
    ...shadow.card,
  },
  pressed: { opacity: 0.7 },
  bar: { width: 28, height: 4, borderRadius: 2, marginBottom: 6 },
  value: { fontFamily: fonts.display700, fontSize: 22, lineHeight: 28, fontVariant: ['tabular-nums'] },
  label: { fontFamily: fonts.body600, fontSize: 12, lineHeight: 16, color: colors.soft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // flexBasis leaves room for the gaps; flexGrow lets a short last row fill the width.
  two: { flexBasis: '45%', flexGrow: 1, minWidth: 0 },
  three: { flexBasis: '30%', flexGrow: 1, minWidth: 0 },
});
