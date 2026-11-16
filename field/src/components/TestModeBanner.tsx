import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onTestModeBanner, type TestModeNotice } from '@/api/testMode';
import { useI18n } from '@/i18n';
import { colors, radius } from '@/theme';
import { Text } from './Text';

/**
 * The amber test-mode strip shown over every screen while the server is in
 * test mode (pretend vendors): "Test mode code: 123456" after a "Send OTP",
 * and "Test mode link · Open link" after anything that sends a link by SMS
 * (the SMS never arrives on the test site). Tap × to close. Never appears on
 * a live system: the server does not send the code or the link there.
 */
export function TestModeBanner() {
  const { t } = useI18n();
  const [notice, setNotice] = useState<TestModeNotice | null>(null);
  const insets = useSafeAreaInsets();
  useEffect(
    () =>
      onTestModeBanner((next) =>
        setNotice((prev) => ({
          code: next.code ?? (next.links ? undefined : prev?.code),
          links: next.links ?? (next.code ? undefined : prev?.links),
        })),
      ),
    [],
  );
  if (!notice || (!notice.code && !notice.links?.length)) return null;
  const links = notice.links ?? [];
  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <View style={styles.box} testID="test-mode-banner" accessibilityRole="alert">
        <View style={styles.text}>
          {notice.code && <Text variant="bodyStrong">{notice.code}</Text>}
          {links.length > 0 && (
            <View style={styles.links} testID="test-mode-link">
              <Text variant="bodyStrong">{t('testMode.link')}</Text>
              {links.map((url, i) => (
                <Pressable
                  key={url}
                  style={styles.open}
                  // On the installed web app this opens a new tab (react-native-web Linking).
                  onPress={() => void Linking.openURL(url)}
                  accessibilityRole="link"
                  accessibilityHint={url}
                  hitSlop={6}
                >
                  <Text variant="bodyStrong" style={styles.openText}>
                    {links.length > 1 ? t('testMode.openLinkN', { n: i + 1 }) : t('testMode.openLink')}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text variant="small">{links.length > 0 ? t('testMode.linkNote') : t('testMode.codeNote')}</Text>
        </View>
        <Pressable onPress={() => setNotice(null)} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={12}>
          <Text variant="bodyStrong">×</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 50, alignItems: 'center' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: 480,
    width: '100%',
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.amber100,
    borderColor: colors.amberBorder,
  },
  text: { flex: 1, gap: 2 },
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  open: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.ink },
  openText: { color: colors.white },
});
