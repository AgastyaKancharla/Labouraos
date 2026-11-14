import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorText } from '@/api/errorText';
import type { OtpProof, OtpSent } from '@/api/types';
import { Banner, Button, CodeInput, Text } from '@/components';
import { useI18n } from '@/i18n';
import { formatCountdown } from '@/lib/format';

export const MAX_RESENDS = 3;
const RESEND_AFTER_MS = 30_000;

interface Props {
  /** Send (or resend, with the previous requestId) the code. */
  send: (resendOf?: string) => Promise<OtpSent>;
  /** Use the typed code; throw to show the error and stay. */
  submit: (proof: OtpProof) => Promise<void>;
  sendLabel: string;
  submitLabel: string;
  /** "Code sent to the number ending 4321." */
  sentText: string;
  /** Checked before the first send; return an error message to stop. */
  beforeSend?: () => string | null;
  /** Shown before the first send (the mobile box, the tick). */
  children?: ReactNode;
  /** "Change number" (mobile forms only). */
  onChangeNumber?: () => void;
  disabled?: boolean;
  testID: string;
}

/**
 * The OTP pattern from the guide's form rules, used for sign-in, the phone
 * of a Google account, every registration (step-up "register"), confirming a
 * vacancy and deleting the account: Send → type the 6 digits → Verify;
 * Resend unlocks after 30 seconds, at most 3 times. Errors in the person's
 * language from the contract's codes.
 */
export function OtpCodeCard({ send, submit, sendLabel, submitLabel, sentText, beforeSend, children, onChangeNumber, disabled, testID }: Props) {
  const { t } = useI18n();
  const [sent, setSent] = useState<OtpSent | null>(null);
  const [code, setCode] = useState('');
  const [resends, setResends] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resendAt = sent?.resendAvailableAt ? new Date(sent.resendAvailableAt).getTime() : now;
  const waitMs = Math.max(0, resendAt - now);
  const resendsLeft = Math.max(0, Math.min(MAX_RESENDS - resends, sent?.resendsLeft ?? MAX_RESENDS));

  useEffect(() => {
    if (!sent) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sent]);

  const doSend = async (isResend: boolean) => {
    const problem = isResend ? null : (beforeSend?.() ?? null);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy('send');
    setError(null);
    try {
      const result = await send(isResend ? sent?.requestId : undefined);
      setSent({ ...result, resendAvailableAt: result.resendAvailableAt ?? new Date(Date.now() + RESEND_AFTER_MS).toISOString() });
      setNow(Date.now());
      setCode('');
      if (isResend) setResends((n) => n + 1);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(null);
    }
  };

  const doVerify = async (value: string = code) => {
    if (!sent || value.length !== 6) {
      setError(t('otp.enterCode'));
      return;
    }
    setBusy('verify');
    setError(null);
    try {
      await submit({ requestId: sent.requestId, code: value });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap} testID={testID}>
      {!sent ? (
        <>
          {children}
          <Button label={sendLabel} onPress={() => void doSend(false)} loading={busy === 'send'} disabled={disabled} testID={`${testID}-send`} />
        </>
      ) : (
        <>
          <Text variant="muted">{sentText}</Text>
          <CodeInput label={t('otp.code')} value={code} onChange={setCode} onComplete={(value) => void doVerify(value)} autoFocus testID={`${testID}-code`} />
          <Button label={submitLabel} onPress={() => void doVerify()} loading={busy === 'verify'} disabled={disabled} testID={`${testID}-verify`} />
          <View style={styles.row}>
            {resendsLeft > 0 ? (
              <Button
                label={waitMs > 0 ? t('otp.resendIn', { time: formatCountdown(waitMs) }) : t('otp.resend')}
                variant="secondary"
                disabled={waitMs > 0 || busy !== null}
                onPress={() => void doSend(true)}
                testID={`${testID}-resend`}
                style={styles.flex}
              />
            ) : (
              <Text variant="muted" style={styles.flex} testID={`${testID}-no-resends`}>
                {t('otp.noResendsLeft')}
              </Text>
            )}
            {onChangeNumber ? (
              <Button
                label={t('otp.changeNumber')}
                variant="secondary"
                onPress={() => {
                  setSent(null);
                  setCode('');
                  setError(null);
                  onChangeNumber();
                }}
                testID={`${testID}-change`}
                style={styles.flex}
              />
            ) : null}
          </View>
        </>
      )}
      {error ? <Banner tone="error" message={error} testID={`${testID}-error`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
});
