import { StyleSheet, View } from 'react-native';
import { Text } from '@/components';
import { useI18n, type MessageKey } from '@/i18n';
import { accents, colors, fonts, type Accent } from '@/theme';

/**
 * The steps of visiting a shop and onboarding it, all inside the Visits tab
 * (Laboura Field redesign, 16 Nov): board photo → talk → selfie → business
 * form → agreement → vacancies → candidates.
 */
export const ONBOARDING_STEPS = 7;
export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Each step has its own colour: outside royal, talking gold, proof green, form cyan, agreement orange, vacancies navy, candidates green. */
const STEP_ACCENT: Record<OnboardingStep, Accent> = { 1: 'royal', 2: 'gold', 3: 'green', 4: 'cyan', 5: 'orange', 6: 'navy', 7: 'green' };
const STEP_LABEL: Record<OnboardingStep, MessageKey> = {
  1: 'steps.photo',
  2: 'steps.talk',
  3: 'steps.selfie',
  4: 'steps.form',
  5: 'steps.agreement',
  6: 'steps.vacancies',
  7: 'steps.candidates',
};

/** "Step 4 of 7 · business form" with a numbered coloured disc and a seven-part colour-coded bar. */
export function StepHeader({ step }: { step: OnboardingStep }) {
  const { t } = useI18n();
  const current = accents[STEP_ACCENT[step]];
  const label = t('steps.counter', { n: step, total: ONBOARDING_STEPS, label: t(STEP_LABEL[step]) });
  return (
    <View style={styles.box} testID={`visit-step-${step}`} accessibilityLabel={label}>
      <View style={styles.head}>
        <View style={[styles.disc, { backgroundColor: current.raw }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
          <Text style={[styles.discText, { color: current.on }]}>{step}</Text>
        </View>
        <Text variant="label" style={styles.label} testID="step-counter">
          {label}
        </Text>
      </View>
      <View style={styles.bars}>
        {(Object.keys(STEP_ACCENT).map(Number) as OnboardingStep[]).map((n) => (
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
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
});
