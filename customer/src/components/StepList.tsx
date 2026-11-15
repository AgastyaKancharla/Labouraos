import { StyleSheet, View } from 'react-native';
import type { StepState } from '@/api/types';
import { useI18n } from '@/i18n';
import { accents, colors, fonts, radius, type Accent } from '@/theme';
import { Icon, type IconName } from './Icon';
import { IconTile } from './IconTile';
import { Text } from './Text';

export interface StepItem {
  key: string;
  label: string;
  state: StepState;
  /** The step's own drawn icon, shown in a tile of its palette colour. */
  icon?: IconName;
  accent?: Accent;
}

/**
 * The sign-up tracker rows. Each step has its own coloured icon tile (the
 * Command Center's colour-coded steps). On the right: a green tick = done,
 * the amber word = in progress, the grey word = not started. The step to do
 * next (the first one not done) is highlighted in its own colour. The
 * state is also spoken as a word for screen readers, never by colour alone.
 */
export function StepList({ steps, testID }: { steps: StepItem[]; testID?: string }) {
  const { t } = useI18n();
  const current = steps.findIndex((s) => s.state !== 'done');
  return (
    <View style={styles.list} testID={testID}>
      {steps.map((step, index) => {
        const word = t(`step.${step.state}`);
        const accent = step.accent ?? 'royal';
        const a = accents[accent];
        const isCurrent = index === current;
        return (
          <View
            key={step.key}
            style={[styles.row, isCurrent && { backgroundColor: a.bg, borderColor: a.raw }]}
            accessible
            accessibilityLabel={`${step.label}: ${word}`}
            testID={testID ? `${testID}-${step.key}-${step.state}` : undefined}
          >
            {step.icon ? (
              <IconTile icon={step.icon} accent={accent} size={36} testID={testID ? `${testID}-${step.key}-tile` : undefined} />
            ) : (
              <View style={[styles.mark, styles[step.state]]}>
                {step.state === 'done' ? (
                  <Icon name="check" size={16} color={colors.white} />
                ) : (
                  <View style={[styles.dot, step.state === 'in_progress' ? styles.dotOn : styles.dotOff]} />
                )}
              </View>
            )}
            <Text style={[styles.label, isCurrent && styles.labelCurrent]}>{step.label}</Text>
            {step.icon && step.state === 'done' ? (
              <View style={styles.tick} testID={testID ? `${testID}-${step.key}-tick` : undefined}>
                <Icon name="check" size={15} color={colors.white} />
              </View>
            ) : (
              <Text variant="muted" style={step.icon && step.state === 'in_progress' ? styles.wordOn : undefined}>
                {word}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  mark: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: colors.green },
  in_progress: { backgroundColor: colors.amber },
  not_started: { backgroundColor: colors.neutral100, borderWidth: 1, borderColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: colors.white },
  dotOff: { borderWidth: 1.5, borderColor: colors.soft },
  label: { flex: 1, fontFamily: fonts.body600, fontSize: 16, color: colors.ink },
  labelCurrent: { fontFamily: fonts.body700, color: colors.navy },
  tick: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  wordOn: { fontFamily: fonts.body700, color: colors.amber },
});
