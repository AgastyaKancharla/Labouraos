import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { onTestModeBanner, type TestModeNotice } from '@/api/testMode';
import { useI18n } from '@/i18n';
import { colors, radius, touch } from '@/theme';
import { Text } from './Text';

/**
 * The amber test-mode strip shown above every screen while the server is in
 * test mode (pretend vendors): "Test mode code: 123456" after a "Send OTP",
 * and "Test mode link · Open link" after anything that sends a link by SMS
 * (the SMS never arrives on the test site). Tap × to close. Never appears on
 * a live system: the server does not send the code or the link there.
 *
 * It takes its own space at the top and pushes the app down (fix list A7):
 * the header's back arrow, language and account stay visible and tappable
 * while it shows. Wrap the app in it; the screens below then see no top
 * safe-area inset, because the strip already sits under the status bar.
 */
export function TestModeBanner({ children }: { children?: ReactNode }) {
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
  const showing = !!notice && (!!notice.code || !!notice.links?.length);
  const below = useMemo(() => (showing ? { ...insets, top: 0 } : insets), [insets, showing]);
  const strip = showing ? <Strip notice={notice!} top={insets.top} onClose={() => setNotice(null)} /> : null;
  if (children === undefined) return strip;
  // The same tree with or without the strip, so the app below never remounts (it keeps its screens).
  return (
    <View style={styles.column} testID="test-mode-area">
      {strip}
      <SafeAreaInsetsContext.Provider value={below}>
        <View style={styles.flex}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

function Strip({ notice, top, onClose }: { notice: TestModeNotice; top: number; onClose: () => void }) {
  const { t } = useI18n();
  const links = notice.links ?? [];
  return (
    <View style={[styles.wrap, { paddingTop: top + 8 }]}>
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
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} style={styles.close} testID="test-mode-close">
          <Text variant="bodyStrong">×</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  flex: { flex: 1 },
  wrap: { paddingHorizontal: 12, paddingBottom: 8, alignItems: 'center', backgroundColor: colors.navy },
  close: { minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
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
  open: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.ink },
  openText: { color: colors.white },
});
