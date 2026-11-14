import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme';

/** `.bar`: thin progress bar, value 0–1. */
export function ProgressBar({ value, color = colors.blue }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 999, backgroundColor: 'rgba(11,30,74,0.08)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
});
