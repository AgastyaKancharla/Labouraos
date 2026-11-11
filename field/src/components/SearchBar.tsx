import { Pressable, StyleSheet } from 'react-native';
import { useI18n } from '@/i18n';
import { colors, radius, touch } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';

interface Props {
  onPress: () => void;
  placeholder?: string;
}

/**
 * The search bar at the top of every screen (guide: "Search on every
 * screen"). On Home it is a button that opens the search screen.
 */
export function SearchBar({ onPress, placeholder }: Props) {
  const { t } = useI18n();
  const label = placeholder ?? t('common.search');
  return (
    <Pressable accessibilityRole="search" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.bar, pressed && styles.pressed]}>
      <Icon name="search" size={15} />
      <Text variant="small" color={colors.soft}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: touch.min,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  pressed: { borderColor: colors.cyanRaw },
});
