import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, shadow, touch } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'navy' | 'success' | 'danger' | 'light';

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  /** Version 2: a round arrow at the right end — for the one main action on a screen. */
  arrow?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * `.btn` from the designs: `.bp` primary blue, `.bs` white with blue text,
 * `.bn` navy, `.bg` green, `.bd` red outline; `light` is white on the navy
 * welcome screen. Version 2: 56 px tall, 18 px corners and layered shadows so
 * buttons look raised.
 */
export function Button({ label, variant = 'primary', loading = false, fullWidth = false, disabled, icon, arrow = false, style, ...rest }: Props) {
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
        <View style={[styles.row, arrow && styles.rowArrow]}>
          {icon}
          <Text style={[styles.text, v.text, arrow && styles.textArrow]} numberOfLines={2}>
            {label}
          </Text>
          {arrow ? (
            <View style={[styles.arrow, { backgroundColor: v.arrow }]}>
              <Icon name="chevron-right" size={18} color={variant === 'light' ? colors.white : v.text.color} />
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: Math.max(touch.min, 56),
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowArrow: { alignSelf: 'stretch', justifyContent: 'space-between', paddingLeft: 6 },
  text: { fontFamily: fonts.body700, fontSize: 16.5, textAlign: 'center' },
  textArrow: { flex: 1, textAlign: 'left' },
  arrow: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
  disabled: { opacity: 0.5 },
});

const variants = {
  primary: {
    ...StyleSheet.create({
      container: { backgroundColor: colors.blue, ...shadow.primary },
      pressed: { backgroundColor: colors.bluePressed, transform: [{ translateY: 1 }] },
      text: { color: colors.white },
    }),
    arrow: 'rgba(255,255,255,0.22)',
  },
  secondary: {
    ...StyleSheet.create({
      container: { backgroundColor: colors.surface, borderColor: colors.border, ...shadow.secondary },
      pressed: { backgroundColor: colors.blue100, transform: [{ translateY: 1 }] },
      text: { color: colors.blue },
    }),
    arrow: colors.blue100,
  },
  navy: {
    ...StyleSheet.create({
      container: { backgroundColor: colors.navy, ...shadow.primary },
      pressed: { opacity: 0.9, transform: [{ translateY: 1 }] },
      text: { color: colors.white },
    }),
    arrow: 'rgba(255,255,255,0.18)',
  },
  success: {
    ...StyleSheet.create({
      container: { backgroundColor: colors.green, ...shadow.primary },
      pressed: { opacity: 0.9, transform: [{ translateY: 1 }] },
      text: { color: colors.white },
    }),
    arrow: 'rgba(255,255,255,0.22)',
  },
  danger: {
    ...StyleSheet.create({
      container: { backgroundColor: colors.surface, borderColor: 'rgba(187,35,43,0.4)', ...shadow.secondary },
      pressed: { backgroundColor: colors.tomato100 },
      text: { color: colors.tomato },
    }),
    arrow: colors.tomato100,
  },
  light: {
    ...StyleSheet.create({
      container: { backgroundColor: colors.white, ...shadow.light },
      pressed: { backgroundColor: colors.blue100, transform: [{ translateY: 1 }] },
      text: { color: colors.navy },
    }),
    arrow: colors.blue,
  },
};
