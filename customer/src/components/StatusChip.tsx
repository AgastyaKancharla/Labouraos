import { StyleSheet, View } from 'react-native';
import { fonts, radius, tones, type Tone } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

interface Props {
  label: string;
  tone?: Tone;
  /** Shows a small dot before the label (live status). */
  dot?: boolean;
  /** A small drawn icon before the label (e.g. a tick when done). */
  icon?: IconName;
  /** What a screen reader says, when the label alone does not tell the state. */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * `.tag` pill from the designs: the text-safe colour of a family on its light
 * background — green (good), amber, crit (orange), tomato (red), cyan, blue
 * (royal), navy and neutral grey. Readable on white and on the hero gradient.
 */
export function StatusChip({ label, tone = 'neutral', dot = false, icon, accessibilityLabel, testID }: Props) {
  const t = tones[tone];
  return (
    <View
      style={[styles.chip, { backgroundColor: t.bg }]}
      accessibilityRole="text"
      accessible={accessibilityLabel ? true : undefined}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: t.fg }]} /> : null}
      {icon ? <Icon name={icon} size={12} color={t.fg} /> : null}
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
