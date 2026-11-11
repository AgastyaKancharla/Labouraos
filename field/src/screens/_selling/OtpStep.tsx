import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, CodeInput, Text } from '@/components';
import type { OtpSent } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { formatCountdown } from '@/lib/format';
import { colors, fonts, radius } from '@/theme';
import { ErrorBanner } from './index';

export const RESEND_WAIT_MS = 30_000;
export const MAX_RESENDS = 3;

/**
 * The owner's OTP in the shop: Send → he reads the code out → Verify;
 * Resend unlocks after 30 seconds, at most 3 times (guide, Forms). Needs
 * signal — the owner has to be there.
 */
export function OtpStep({ send, verify, intro, sendLabel, verifyLabel, testID = 'otp', initial = null }: {
  send: (previousRequestId?: string) => Promise<OtpSent>;
  verify: (requestId: string, code: string) => Promise<unknown>;
  /** Text above the boxes once sent, e.g. "We sent an OTP to Ganesh (owner, ******3310)…". */
  intro: (sent: OtpSent) => string;
  sendLabel: string;
  verifyLabel: string;
  testID?: string;
  /** A code already sent (e.g. by saving the vacancy). */
  initial?: OtpSent | null;
}) {
  const { t } = useI18n();
  const queue = useOfflineQueue();
  const [sent, setSent] = useState<OtpSent | null>(initial);
  const [sentAt, setSentAt] = useState(() => (initial ? Date.now() : 0));
  const [resends, setResends] = useState(0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const waiting = sent !== null && now - sentAt < RESEND_WAIT_MS;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  async function doSend() {
    setBusy(true);
    setError(null);
    try {
      const result = await queue.live(() => send(sent?.otpRequestId));
      if (sent) setResends((n) => n + 1);
      setSent(result);
      setSentAt(Date.now());
      setNow(Date.now());
      setCode('');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function doVerify(value = code) {
    if (!sent || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await queue.live(() => verify(sent.otpRequestId, value));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!sent) {
    return (
      <View style={styles.gap}>
        <Button label={sendLabel} loading={busy} onPress={() => void doSend()} testID={`${testID}-send`} />
        <ErrorBanner error={error} />
      </View>
    );
  }
  return (
    <View style={styles.box} testID={`${testID}-sent`}>
      <Text>{intro(sent)}</Text>
      <CodeInput value={code} onChange={setCode} label={t('selling.otpCode')} onComplete={(v) => void doVerify(v)} testID={`${testID}-code`} />
      <Text variant="muted" testID={`${testID}-resend-note`}>
        {waiting
          ? t('selling.resendIn', { time: formatCountdown(RESEND_WAIT_MS - (now - sentAt)) })
          : resends >= MAX_RESENDS
            ? t('selling.noMoreResends')
            : ''}
      </Text>
      <View style={styles.row}>
        <Button
          label={t('selling.resend')}
          variant="secondary"
          style={styles.flex}
          disabled={waiting || resends >= MAX_RESENDS || busy}
          onPress={() => void doSend()}
          testID={`${testID}-resend`}
        />
        <Button label={verifyLabel} style={styles.flex} disabled={code.length !== 6} loading={busy} onPress={() => void doVerify()} testID={`${testID}-verify`} />
      </View>
      <ErrorBanner error={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 10 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  box: { gap: 10, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  strong: { fontFamily: fonts.body700 },
});
