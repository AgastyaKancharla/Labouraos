import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, touch } from '@/theme';
import { Text } from './Text';

interface Props {
  title: string;
  subtitle?: string;
  /** Right side: usually a StatusChip. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Hide the divider (last row of a card). */
  last?: boolean;
  testID?: string;
}

/** `.row` from the designs: text on the left, chip on the right, divider below. */
export function ListRow({ title, subtitle, trailing, onPress, last, testID }: Props) {
  const content = (
    <>
      <View style={styles.text}>
        <Text>{title}</Text>
        {subtitle ? <Text variant="muted">{subtitle}</Text> : null}
      </View>
      {trailing}
    </>
  );
  const style = [styles.row, !last && styles.divider];
  if (!onPress) {
    return (
      <View style={style} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [...style, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: touch.min,
    paddingVertical: 10,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  text: { flex: 1, gap: 2 },
  pressed: { opacity: 0.6 },
});
