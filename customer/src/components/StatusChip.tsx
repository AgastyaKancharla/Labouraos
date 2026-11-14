import { StyleSheet, View } from 'react-native';
import { fonts, radius, tones, type Tone } from '@/theme';
import { Text } from './Text';

interface Props {
  label: string;
  tone?: Tone;
  /** Shows a small dot before the label (live status). */
  dot?: boolean;
}

/** `.tag` pill from the designs (`.tg` green, `.ta` amber, `.tb` blue, `.tn` grey…). */
export function StatusChip({ label, tone = 'neutral', dot = false }: Props) {
  const t = tones[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]} accessibilityRole="text">
      {dot ? <View style={[styles.dot, { backgroundColor: t.fg }]} /> : null}
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
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontFamily: fonts.body700, fontSize: 12 },
});
