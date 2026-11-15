import { StyleSheet, View } from 'react-native';
import { fonts, radius, tones, type Tone } from '@/theme';
import { Text } from './Text';

interface Props {
  label: string;
  tone?: Tone;
  /**
   * The small dot before the label in the tone's raw brand colour — the
   * colour code at a glance. Shown on every coloured tone unless turned off;
   * never on the grey "not applicable" tone unless asked for.
   */
  dot?: boolean;
  testID?: string;
}

/**
 * `.tag` pill from the designs (`.tg` green, `.ta` amber, `.tb` blue, `.tn`
 * grey…): text-safe words on a light background, a raw-colour dot and a
 * thin border in the same colour.
 */
export function StatusChip({ label, tone = 'neutral', dot, testID }: Props) {
  const t = tones[tone];
  const showDot = dot ?? tone !== 'neutral';
  return (
    <View style={[styles.chip, { backgroundColor: t.bg, borderColor: `${t.dot}59` }]} accessibilityRole="text" testID={testID}>
      {showDot ? <View style={[styles.dot, { backgroundColor: t.dot }]} /> : null}
      <Text style={[styles.text, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontFamily: fonts.body700, fontSize: 10.5 },
});
