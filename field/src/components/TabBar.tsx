import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, headerGradient, touch } from '@/theme';
import { Swoosh } from './Swoosh';
import { Text } from './Text';

export interface TabItem {
  /** Route name in app/(app)/(tabs)/, e.g. "index", "visits". */
  name: string;
  label: string;
}

interface Props {
  items: TabItem[];
  activeName: string;
  onSelect: (name: string) => void;
}

/**
 * Bottom tab bar from the designs: Home · Visits · Job seekers · Vacancies ·
 * Map · Targets on the blue gradient, the active tab marked by a light-blue
 * bar above its label.
 */
export function TabBar({ items, activeName, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View>
      <Swoosh height={3} />
      <LinearGradient colors={headerGradient} style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.row} accessibilityRole="tablist">
          {items.map((item) => {
            const active = item.name === activeName;
            return (
              <Pressable
                key={item.name}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
                testID={`tab-${item.name}`}
                onPress={() => onSelect(item.name)}
                style={styles.tab}
              >
                <View style={[styles.indicator, active && styles.indicatorOn]} />
                <Text style={[styles.label, active && styles.labelOn]} numberOfLines={2}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingTop: 8, paddingHorizontal: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: touch.min, justifyContent: 'center', paddingHorizontal: 2 },
  indicator: { width: 22, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  indicatorOn: { backgroundColor: colors.navAccent },
  label: { fontFamily: fonts.body600, fontSize: 10.5, color: colors.navSoft, textAlign: 'center' },
  labelOn: { color: colors.white },
});
