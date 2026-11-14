import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onTestModeBanner } from '@/api/testMode';
import { colors, radius } from '@/theme';
import { Text } from './Text';

/**
 * The amber "Test mode code: 123456" strip shown over every screen after a
 * "Send OTP" while the server is in OTP test mode (pretend vendors). Tap ×
 * to close. Never appears on a live system: the server does not send it.
 */
export function TestModeBanner() {
  const [banner, setBanner] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  useEffect(() => onTestModeBanner(setBanner), []);
  if (!banner) return null;
  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <View style={styles.box} testID="test-mode-banner" accessibilityRole="alert">
        <View style={styles.text}>
          <Text variant="bodyStrong">{banner}</Text>
          <Text variant="small">Test mode: no SMS is sent.</Text>
        </View>
        <Pressable onPress={() => setBanner(null)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
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
});
