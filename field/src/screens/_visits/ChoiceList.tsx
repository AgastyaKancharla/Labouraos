import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components';
import { colors, radius, touch } from '@/theme';

export interface Choice<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

/** A radio list (`input radio` in the designs): one tall row per choice. */
export function ChoiceList<V extends string>({
  choices,
  value,
  onChange,
  testID,
}: {
  choices: readonly Choice<V>[];
  value: V | null;
  onChange: (value: V) => void;
  testID?: string;
}) {
  return (
    <View style={styles.list} accessibilityRole="radiogroup" testID={testID}>
      {choices.map((c) => {
        const on = c.value === value;
        return (
          <Pressable
            key={c.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: !!c.disabled }}
            accessibilityLabel={c.label}
            disabled={c.disabled}
            onPress={() => onChange(c.value)}
            style={[styles.row, on && styles.on, c.disabled && styles.disabled]}
            testID={testID ? `${testID}-${c.value}` : undefined}
          >
            <View style={[styles.dot, on && styles.dotOn]}>{on ? <View style={styles.inner} /> : null}</View>
            <Text variant={on ? 'bodyStrong' : 'body'} style={styles.label}>
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small selectable pills, e.g. dates and "who did you speak to". */
export function ChipChoices<V extends string>({
  choices,
  value,
  onChange,
  testID,
  scroll,
}: {
  choices: readonly Choice<V>[];
  value: V | null;
  onChange: (value: V) => void;
  testID?: string;
  scroll?: boolean;
}) {
  return (
    <View style={[styles.chips, scroll && styles.noWrap]} accessibilityRole="radiogroup" testID={testID}>
      {choices.map((c) => {
        const on = c.value === value;
        return (
          <Pressable
            key={c.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={c.label}
            onPress={() => onChange(c.value)}
            style={[styles.chip, on && styles.chipOn]}
            testID={testID ? `${testID}-${c.value}` : undefined}
          >
            <Text variant="small" color={on ? colors.white : colors.ink}>
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: touch.min,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  on: { borderColor: colors.blue, backgroundColor: colors.blue100 },
  disabled: { opacity: 0.45 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  dotOn: { borderColor: colors.blue },
  inner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  label: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  noWrap: { flexWrap: 'wrap' },
  chip: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.blue, borderColor: colors.blue },
});
