import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

export interface StatItem {
  key: string;
  value: string;
  label: string;
}

/** The "Today" row of small numbers (FA03), evenly spread. */
export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <View style={styles.row}>
      {items.map((item) => (
        <View key={item.key} style={styles.cell} accessible accessibilityLabel={`${item.value} ${item.label}`} testID={`stat-${item.key}`}>
          <Text variant="stat">{item.value}</Text>
          <Text variant="tiny" align="center">
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', gap: 2 },
});
