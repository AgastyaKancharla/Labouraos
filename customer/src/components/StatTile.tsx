import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { accents, colors, fonts, radius, shadow, type Accent } from '@/theme';
import type { IconName } from './Icon';
import { IconTile } from './IconTile';
import { Text } from './Text';

interface Props {
  label: string;
  value: string | number;
  accent?: Accent;
  icon?: IconName;
  testID?: string;
}

/**
 * The Command Center `.stat` tile (web StatTile): a coloured top bar, a
 * drawn icon in a round tile, a big number and its label. The warning
 * tones (good, gold, orange, red) also colour the number — in the
 * text-safe colour of that family — and tint the border, exactly like the
 * web tile.
 */
const Columns = createContext<2 | 3>(3);

export function StatTile({ label, value, accent = 'royal', icon, testID }: Props) {
  const a = accents[accent];
  const columns = useContext(Columns);
  return (
    <View
      style={[styles.tile, columns === 2 ? styles.half : styles.third, { borderColor: a.border }]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
    >
      <View style={[styles.bar, { backgroundColor: a.raw }]} testID={testID ? `${testID}-bar-${accent}` : undefined} />
      <View style={styles.body}>
        {icon ? <IconTile icon={icon} accent={accent} size={30} round /> : null}
        <Text style={[styles.value, a.warn ? { color: a.fg } : null]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        <Text style={styles.label}>{label}</Text>
      </View>
    </View>
  );
}

/** A row of StatTiles that wraps: `columns` tiles per line. */
export function StatGrid({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 }) {
  return (
    <Columns.Provider value={columns}>
      <View style={styles.grid}>{children}</View>
    </Columns.Provider>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow.card,
  },
  bar: { height: 4 },
  body: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 6 },
  value: { fontFamily: fonts.display700, fontSize: 22, lineHeight: 28, color: colors.ink, fontVariant: ['tabular-nums'] },
  label: { fontFamily: fonts.body600, fontSize: 13, lineHeight: 17, color: colors.soft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Basis below 1/2 and 1/3 so the gap fits; flexGrow fills the rest.
  half: { flexBasis: '40%' },
  third: { flexBasis: '28%' },
});
