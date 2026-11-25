import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useI18n } from '@/i18n';
import { colors, fonts, touch } from '@/theme';
import { Text } from './Text';

/** Codes go on WhatsApp first; "Send by SMS" is offered this long after a code was sent (rev 211). */
export const SEND_BY_SMS_AFTER_MS = 30_000;

/**
 * The small "Send by SMS" on a code screen (Master Guide rev 211): hidden until
 * 30 seconds after the code went (on WhatsApp first), then asks for the code by
 * SMS instead.
 */
export function SendBySms({ sentAt, onPress, disabled, testID = 'send-by-sms' }: { sentAt: number | null; onPress: () => void; disabled?: boolean; testID?: string }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const ready = sentAt !== null && now - sentAt >= SEND_BY_SMS_AFTER_MS;
  useEffect(() => {
    if (sentAt === null || ready) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sentAt, ready]);
  if (!ready) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('otp.sendBySms')}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.sms, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <Text style={styles.text}>{t('otp.sendBySms')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sms: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  text: { fontFamily: fonts.body700, fontSize: 13, color: colors.blue, textDecorationLine: 'underline' },
});
