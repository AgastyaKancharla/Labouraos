import { StyleSheet, View } from 'react-native';
import { accents, type Accent } from '@/theme';
import { Emoji } from './Emoji';
import { Icon, type IconName } from './Icon';

interface Props {
  /** A drawn icon on the raw brand colour (Command Center `.tile.t-<accent>`). */
  icon?: IconName;
  /** Or a friendly emoji picture on the accent's light background. */
  emoji?: string;
  accent?: Accent;
  size?: number;
  testID?: string;
}

/**
 * A coloured round tile holding a drawn icon or an emoji picture. Always
 * decorative: the words next to it carry the meaning, so it is hidden from
 * screen readers.
 */
export function IconTile({ icon, emoji, accent = 'royal', size = 36, testID }: Props) {
  const a = accents[accent];
  const drawn = !!icon;
  return (
    <View
      style={[styles.tile, { width: size, height: size, borderRadius: size / 2, backgroundColor: drawn ? a.raw : a.bg }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      testID={testID}
    >
      {icon ? <Icon name={icon} size={Math.round(size * 0.5)} color={a.on} strokeWidth={2.2} /> : null}
      {!icon && emoji ? <Emoji symbol={emoji} size={Math.round(size * 0.52)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
