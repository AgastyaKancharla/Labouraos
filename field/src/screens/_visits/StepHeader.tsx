import { StyleSheet, View } from 'react-native';
import { Text } from '@/components';
import { accents, colors, fonts, type Accent } from '@/theme';

/** Each visit step has its own colour: outside (royal), talking (gold), proof (green). */
const STEP_ACCENT: Record<1 | 2 | 3, Accent> = { 1: 'royal', 2: 'gold', 3: 'green' };

/** "Step 1 of 3 · outside, before going in" with a numbered coloured disc and a three-part colour-coded bar. */
export function StepHeader({ step, label }: { step: 1 | 2 | 3; label: string }) {
  const current = accents[STEP_ACCENT[step]];
  return (
    <View style={styles.box} testID={`visit-step-${step}`}>
      <View style={styles.head}>
        <View style={[styles.disc, { backgroundColor: current.raw }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
          <Text style={[styles.discText, { color: current.on }]}>{step}</Text>
        </View>
        <Text variant="label" style={styles.label}>
          {label}
        </Text>
      </View>
      <View style={styles.bars}>
        {([1, 2, 3] as const).map((n) => (
          <View key={n} style={[styles.bar, n <= step && { backgroundColor: accents[STEP_ACCENT[n]].raw }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  disc: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  discText: { fontFamily: fonts.display700, fontSize: 13, lineHeight: 16 },
  label: { flex: 1 },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
});
