import { StyleSheet, View } from 'react-native';
import { accents, type Accent } from '@/theme';
import { Icon, type IconName } from './Icon';

interface Props {
  icon: IconName;
  accent?: Accent;
  /** Tile size in px (the icon is a little over half of it). */
  size?: number;
  /** Round badge instead of the rounded square (`.tile`). */
  round?: boolean;
  testID?: string;
}

/**
 * The Command Center `.tile` / `.t-*` icon square: a drawn icon on a raw
 * palette colour (royal, navy, cyan, gold, orange, red, green). Decoration
 * only — the text next to it always says what it means, so screen readers
 * skip it.
 */
export function IconTile({ icon, accent = 'royal', size = 34, round = false, testID }: Props) {
  const a = accents[accent];
  return (
    <View
      style={[styles.tile, { width: size, height: size, borderRadius: round ? size / 2 : Math.round(size * 0.3), backgroundColor: a.raw }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID ? `${testID}-${accent}` : undefined}
    >
      <Icon name={icon} size={Math.round(size * 0.55)} color={a.on} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
