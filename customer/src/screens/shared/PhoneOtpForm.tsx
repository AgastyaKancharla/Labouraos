import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { OtpSent } from '@/api/types';
import { isApiError } from '@/api/errors';
import { Banner, Button, CodeInput, Text } from '@/components';
import { Checkbox, MobileField } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatCountdown } from '@/lib/format';
import { isMobile } from '@/lib/validate';

export const MAX_RESENDS = 3;
const RESEND_AFTER_MS = 30_000;

interface Props {
  /** Send the code. `contactConsent` is the "Laboura may call me" tick. */
  send: (phone: string, contactConsent: boolean) => Promise<OtpSent>;
  /** Check the code; throw to show "wrong code". */
  verify: (input: { requestId: string; code: string; contactConsent: boolean }) => Promise<void>;
  testID?: string;
}

/**
 * Mobile number + OTP, by the guide's form rules: +91 fixed, exactly 10
 * digits; Send OTP → type the code → Verify; Resend unlocks after 30 seconds,
 * at most 3 times. Used for "Continue with mobile number" and for the
 * number every Google / Apple account must verify before a profile.
 *
 * The tick (proposal 4.5, C7): "Laboura may call, SMS or WhatsApp me to help
 * me finish registering." Optional; without it only in-app and push
 * reminders are used.
 */
export function PhoneOtpForm({ send, verify, testID = 'phone-otp' }: Props) {
  const { t } = useI18n();
  const [phone, setPhone] = useState('');
  const [contactConsent, setContactConsent] = useState(false);
  const [sent, setSent] = useState<OtpSent | null>(null);
  const [code, setCode] = useState('');
  const [resends, setResends] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resendAt = sent?.resendAvailableAt ? new Date(sent.resendAvailableAt).getTime() : sent ? now + RESEND_AFTER_MS : 0;
  const waitMs = Math.max(0, resendAt - now);
  const resendsLeft = Math.max(0, Math.min(MAX_RESENDS - resends, sent?.resendsLeft ?? MAX_RESENDS));

  useEffect(() => {
    if (!sent) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sent]);

  const message = (err: unknown) => (isApiError(err) ? (err.isNetworkError ? t('common.networkError') : err.message) : t('common.error'));

  const doSend = async (isResend: boolean) => {
    if (!isMobile(phone)) {
      setError(t('otp.invalidMobile'));
      return;
    }
    setBusy('send');
    setError(null);
    try {
      const result = await send(phone, contactConsent);
      setSent({ ...result, resendAvailableAt: result.resendAvailableAt ?? new Date(Date.now() + RESEND_AFTER_MS).toISOString() });
      setNow(Date.now());
      setCode('');
      if (isResend) setResends((n) => n + 1);
    } catch (err) {
      setError(message(err));
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
      await verify({ requestId: sent.requestId, code: value, contactConsent });
    } catch (err) {
      setError(message(err));
      setBusy(null);
      return;
    }
    setBusy(null);
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <MobileField label={t('otp.mobile')} value={phone} onChange={setPhone} editable={!sent} required testID={`${testID}-mobile`} />
      {!sent ? (
        <>
          <Checkbox label={t('otp.contactConsent')} checked={contactConsent} onChange={setContactConsent} testID={`${testID}-consent`} />
          <Button label={t('otp.send')} onPress={() => void doSend(false)} loading={busy === 'send'} testID={`${testID}-send`} />
        </>
      ) : (
        <>
          <Text variant="muted">{t('otp.sentTo', { last4: phone.slice(-4) })}</Text>
          <CodeInput
            label={t('otp.code')}
            value={code}
            onChange={setCode}
            onComplete={(value) => void doVerify(value)}
            autoFocus
            testID={`${testID}-code`}
          />
          <Button label={t('otp.verify')} onPress={() => void doVerify()} loading={busy === 'verify'} testID={`${testID}-verify`} />
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
            <Button
              label={t('otp.changeNumber')}
              variant="secondary"
              onPress={() => {
                setSent(null);
                setCode('');
                setError(null);
              }}
              testID={`${testID}-change`}
              style={styles.flex}
            />
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
