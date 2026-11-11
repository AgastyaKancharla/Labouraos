import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, radius, shadow, touch } from '@/theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'navy' | 'success' | 'danger';

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * `.btn` from the designs: `.bp` primary blue, `.bs` white with blue text,
 * `.bn` navy, `.bg` green, `.bd` red outline. At least 48 px tall.
 */
export function Button({ label, variant = 'primary', loading = false, fullWidth = false, disabled, icon, style, ...rest }: Props) {
  const v = variants[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      accessibilityLabel={label}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        v.container,
        fullWidth && styles.full,
        pressed && !isDisabled && v.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={v.text.color} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={[styles.text, v.text]} numberOfLines={2}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.min,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { fontFamily: fonts.body700, fontSize: 14, textAlign: 'center' },
  disabled: { opacity: 0.5 },
});

const variants = {
  primary: StyleSheet.create({
    container: { backgroundColor: colors.blue, ...shadow.primary },
    pressed: { backgroundColor: colors.bluePressed },
    text: { color: colors.white },
  }),
  secondary: StyleSheet.create({
    container: { backgroundColor: colors.surface, borderColor: colors.border },
    pressed: { backgroundColor: colors.blue100 },
    text: { color: colors.blue },
  }),
  navy: StyleSheet.create({
    container: { backgroundColor: colors.navy },
    pressed: { opacity: 0.9 },
    text: { color: colors.white },
  }),
  success: StyleSheet.create({
    container: { backgroundColor: colors.green },
    pressed: { opacity: 0.9 },
    text: { color: colors.white },
  }),
  danger: StyleSheet.create({
    container: { backgroundColor: colors.surface, borderColor: 'rgba(187,35,43,0.4)' },
    pressed: { backgroundColor: colors.tomato100 },
    text: { color: colors.tomato },
  }),
};
