import { StyleSheet, View } from 'react-native';
import { Text } from '@/components';
import { colors } from '@/theme';

/** "Step 1 of 3 · outside, before going in" with a three-part bar. */
export function StepHeader({ step, label }: { step: 1 | 2 | 3; label: string }) {
  return (
    <View style={styles.box} testID={`visit-step-${step}`}>
      <Text variant="label">{label}</Text>
      <View style={styles.bars}>
        {[1, 2, 3].map((n) => (
          <View key={n} style={[styles.bar, n <= step && styles.on]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border },
  on: { backgroundColor: colors.blue },
});
