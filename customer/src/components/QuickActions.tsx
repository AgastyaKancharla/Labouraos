import { Pressable, StyleSheet, View } from 'react-native';
import { accents, colors, fonts, shadow, type Accent } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface QuickAction {
  key: string;
  label: string;
  icon: IconName;
  accent: Accent;
  onPress: () => void;
}

/**
 * Version 2: a row of round shortcuts under the hero card (like the
 * category row in food apps). Up to four, each a drawn icon on its light
 * palette colour with a short label underneath.
 */
export function QuickActions({ actions, testID }: { actions: QuickAction[]; testID?: string }) {
  return (
    <View style={styles.row} testID={testID}>
      {actions.slice(0, 4).map((a) => {
        const c = accents[a.accent];
        return (
          <Pressable
            key={a.key}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={a.onPress}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            testID={testID ? `${testID}-${a.key}` : undefined}
          >
            <View style={styles.outer}>
              <View style={[styles.inner, { backgroundColor: c.bg }]}>
                <Icon name={a.icon} size={22} color={c.fg} />
              </View>
            </View>
            <Text style={styles.label} numberOfLines={2}>
              {a.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, paddingVertical: 2 },
  item: { flex: 1, alignItems: 'center', gap: 8, minHeight: 96 },
  outer: { width: 62, height: 62, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  inner: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.body600, fontSize: 12.5, lineHeight: 16, color: colors.navy, textAlign: 'center' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
});
