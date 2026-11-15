import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, headerGradient, touch } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Swoosh } from './Swoosh';
import { Text } from './Text';

export interface TabItem {
  /** Route name in app/(app)/(tabs)/, e.g. "index", "visits". */
  name: string;
  label: string;
  /** Drawn icon above the label. */
  icon?: IconName;
}

interface Props {
  items: TabItem[];
  activeName: string;
  onSelect: (name: string) => void;
}

/**
 * Bottom tab bar from the designs: Home · Visits · Job seekers · Vacancies ·
 * Map · Targets on the blue gradient, each with its drawn icon; the active
 * tab is marked by a gold bar, a gold icon and white words.
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
                {item.icon ? <Icon name={item.icon} size={20} strokeWidth={2.1} color={active ? colors.gold : colors.navSoft} /> : null}
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
  bar: { paddingTop: 4, paddingHorizontal: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  tab: { flex: 1, alignItems: 'center', gap: 3, minHeight: touch.min, justifyContent: 'flex-start', paddingHorizontal: 2 },
  indicator: { width: 22, height: 3, borderRadius: 2, backgroundColor: 'transparent', marginBottom: 2 },
  indicatorOn: { backgroundColor: colors.gold },
  label: { fontFamily: fonts.body600, fontSize: 10.5, color: colors.navSoft, textAlign: 'center' },
  labelOn: { color: colors.white },
});
