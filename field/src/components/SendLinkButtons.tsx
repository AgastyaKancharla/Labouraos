import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';
import { colors, fonts, touch } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';

/**
 * The two send buttons wherever Laboura Field sends a person a link (Master
 * Guide rev 211): a primary "Send on WhatsApp" (WhatsApp first; the server
 * sends the SMS by itself if WhatsApp cannot take it or it is not delivered
 * within an hour) and a small "Send by SMS". The line under them says which
 * channel actually carried it (`sentBy` in the answer).
 */
export type SendChannel = 'whatsapp' | 'sms';

type ResultKey = 'send.result.whatsapp' | 'send.result.sms' | 'send.result.smsFallback' | 'send.result.none';

/** Which line to show for a send: the channel that carried it (`sentBy`), or the one pressed when the answer does not say. */
export function sentResultKey(pressed: SendChannel, res: unknown): ResultKey {
  const has = res !== null && typeof res === 'object' && 'sentBy' in res;
  if (!has) return pressed === 'sms' ? 'send.result.sms' : 'send.result.whatsapp';
  const by = (res as { sentBy?: unknown }).sentBy;
  if (by === 'sms') return pressed === 'whatsapp' ? 'send.result.smsFallback' : 'send.result.sms';
  if (by === 'whatsapp') return 'send.result.whatsapp';
  return 'send.result.none';
}

export function SendLinkButtons({
  run,
  onSent,
  onError,
  disabled,
  label,
  testID = 'send-link',
}: {
  run: (channel: SendChannel) => Promise<unknown>;
  onSent?: (res: unknown, channel: SendChannel) => void;
  /** The screen shows the error its own way (an ErrorBanner); without it the error is shown here. */
  onError?: (error: unknown) => void;
  disabled?: boolean;
  /** What is being sent ("Resend agreement link"), shown above the buttons. */
  label?: string;
  testID?: string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<SendChannel | null>(null);
  const [result, setResult] = useState<ResultKey | null>(null);
  const [failed, setFailed] = useState(false);

  async function send(channel: SendChannel) {
    setBusy(channel);
    setResult(null);
    setFailed(false);
    try {
      const res = await run(channel);
      setResult(sentResultKey(channel, res));
      onSent?.(res, channel);
    } catch (e) {
      if (onError) onError(e);
      else setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.box} testID={testID}>
      {label ? <Text variant="label">{label}</Text> : null}
      <Button label={t('send.onWhatsApp')} loading={busy === 'whatsapp'} disabled={disabled || busy !== null} onPress={() => void send('whatsapp')} testID={`${testID}-whatsapp`} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('send.bySms')}
        accessibilityState={{ disabled: !!(disabled || busy !== null), busy: busy === 'sms' }}
        disabled={disabled || busy !== null}
        onPress={() => void send('sms')}
        style={({ pressed }) => [styles.sms, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}
        testID={`${testID}-sms`}
      >
        <Text style={styles.smsText}>{t('send.bySms')}</Text>
      </Pressable>
      {result ? (
        <Text variant="muted" testID={`${testID}-result`}>
          {t(result)}
        </Text>
      ) : null}
      {failed ? (
        <Text variant="muted" testID={`${testID}-error`}>
          {t('send.result.none')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  sms: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center' },
  smsText: { fontFamily: fonts.body700, fontSize: 13, color: colors.blue, textDecorationLine: 'underline' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
