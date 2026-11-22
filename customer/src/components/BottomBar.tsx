import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, shadow } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface BarItem {
  key: string;
  label: string;
  icon: IconName;
  onPress: () => void;
  active?: boolean;
}

interface Props {
  items: BarItem[];
  /** The one main action for this person (Add vacancy, Send lead), as a round button in the middle. */
  centre?: { label: string; icon: IconName; onPress: () => void; testID?: string };
  testID?: string;
}

/**
 * Version 2: the bottom bar on Home — four places and, for businesses and
 * referral partners, a raised round button in the middle for their main
 * action. Sits above Android's own buttons (edge to edge).
 */
export function BottomBar({ items, centre, testID }: Props) {
  const insets = useSafeAreaInsets();
  const half = Math.ceil(items.length / 2);
  const render = (it: BarItem) => (
    <Pressable
      key={it.key}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!it.active }}
      accessibilityLabel={it.label}
      onPress={it.onPress}
      style={styles.item}
      testID={testID ? `${testID}-${it.key}` : undefined}
    >
      <View style={[styles.pill, it.active && styles.pillOn]}>
        <Icon name={it.icon} size={22} color={it.active ? colors.navy : colors.soft} />
      </View>
      <Text style={[styles.label, it.active && styles.labelOn]} numberOfLines={1}>
        {it.label}
      </Text>
    </Pressable>
  );
  return (
    <View style={[styles.bar, { paddingBottom: 10 + insets.bottom }]} accessibilityRole="tablist" testID={testID}>
      {items.slice(0, half).map(render)}
      {centre ? (
        <Pressable accessibilityRole="button" accessibilityLabel={centre.label} onPress={centre.onPress} style={styles.centre} testID={centre.testID}>
          <View style={styles.fab}>
            <Icon name={centre.icon} size={26} color={colors.white} />
          </View>
          <Text style={[styles.label, styles.labelOn]} numberOfLines={1}>
            {centre.label}
          </Text>
        </Pressable>
      ) : null}
      {items.slice(half).map(render)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.surface,
    ...shadow.bar,
  },
  item: { flex: 1, alignItems: 'center', gap: 4, minHeight: 52 },
  pill: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: colors.blue100 },
  label: { fontFamily: fonts.body600, fontSize: 12, color: colors.soft },
  labelOn: { color: colors.navy, fontFamily: fonts.body700 },
  centre: { flex: 1, alignItems: 'center', gap: 4, marginTop: -30 },
  fab: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', ...shadow.fab },
});
