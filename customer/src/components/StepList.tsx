import { StyleSheet, View } from 'react-native';
import type { StepState } from '@/api/types';
import { useI18n } from '@/i18n';
import { colors, fonts } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';

export interface StepItem {
  key: string;
  label: string;
  state: StepState;
}

/**
 * The sign-up tracker rows: tick = done (green), dot = in progress (amber), ring = not
 * started (grey) — the same three states as the agent's status panel. The
 * state is also spoken as a word for screen readers, never by colour alone.
 */
export function StepList({ steps, testID }: { steps: StepItem[]; testID?: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.list} testID={testID}>
      {steps.map((step) => {
        const word = t(`step.${step.state}`);
        return (
          <View
            key={step.key}
            style={styles.row}
            accessible
            accessibilityLabel={`${step.label}: ${word}`}
            testID={testID ? `${testID}-${step.key}-${step.state}` : undefined}
          >
            <View style={[styles.mark, styles[step.state]]}>
              {step.state === 'done' ? (
                <Icon name="check" size={16} color={colors.white} />
              ) : (
                <View style={[styles.dot, step.state === 'in_progress' ? styles.dotOn : styles.dotOff]} />
              )}
            </View>
            <Text style={styles.label}>{step.label}</Text>
            <Text variant="muted">{word}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  mark: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: colors.green },
  in_progress: { backgroundColor: colors.amber },
  not_started: { backgroundColor: colors.neutral100, borderWidth: 1, borderColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: colors.white },
  dotOff: { borderWidth: 1.5, borderColor: colors.soft },
  label: { flex: 1, fontFamily: fonts.body600, fontSize: 16, color: colors.ink },
});
