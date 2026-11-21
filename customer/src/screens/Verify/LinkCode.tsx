import { StyleSheet, View } from 'react-native';
import { Banner, Card, ListRow, StatusChip, Text } from '@/components';
import { useI18n } from '@/i18n';
import { stepErrorText } from '@/verify/errors';
import type { OtpSent } from '@/verify/types';
import { OtpCodeCard } from '../shared/OtpCodeCard';

/**
 * The first screen of a person's own steps (AC-3): nothing about them shows
 * until they type the code sent to their own number for this link. The code
 * stays valid for the next steps until it runs out (5 minutes after it was
 * sent); then they come back here for a new one.
 */
export function LinkCode({
  title,
  intro,
  steps,
  maskedPhone,
  warning,
  codeRanOut,
  send,
  verify,
  testID,
}: {
  title: string;
  intro: string;
  steps: string[];
  maskedPhone: string;
  warning?: string | null;
  codeRanOut: boolean;
  send: () => Promise<OtpSent>;
  verify: (requestId: string, code: string) => Promise<void>;
  testID: string;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.gap} testID={testID}>
      <Text variant="h1">{title}</Text>
      <Text variant="muted">{intro}</Text>
      {codeRanOut ? <Banner tone="info" message={t('verify.codeRanOut')} testID={`${testID}-ran-out`} /> : null}
      {warning ? <Banner tone="warn" message={warning} /> : null}
      <Card>
        {steps.map((label, i) => (
          <ListRow key={label} title={label} last={i === steps.length - 1} />
        ))}
      </Card>
      <Card title={t('verify.codeTitle')} accent="royal">
        <OtpCodeCard
          testID={`${testID}-otp`}
          send={send}
          submit={(proof) => verify(proof.requestId, proof.code)}
          sendLabel={t('verify.codeSend')}
          submitLabel={t('verify.codeOpen')}
          sentText={t('verify.codeSent', { phone: maskedPhone })}
          describeError={(err) => stepErrorText(t, err)}
        >
          <Text variant="muted">{t('verify.codeIntro', { phone: maskedPhone })}</Text>
        </OtpCodeCard>
      </Card>
    </View>
  );
}

/** "Done" / "To do" beside each step on the "Welcome back" screen. */
export function DoneChip({ done, label }: { done: boolean; label?: string }) {
  const { t } = useI18n();
  return <StatusChip label={label ?? (done ? t('verify.done') : t('verify.toDo'))} tone={done ? 'green' : label ? 'amber' : 'neutral'} />;
}

const styles = StyleSheet.create({ gap: { gap: 14 } });
