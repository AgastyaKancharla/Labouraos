import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { colors, fonts, fontSize, radius, touch } from '@/theme';
import { Text } from './Text';

interface Props extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
}

/** `.fld`: bold small label above a 48 px input. Font 16 so iPhone does not zoom. */
export const TextField = forwardRef<TextInputInstance, Props>(function TextField({ label, error, hint, style, ...rest }, ref) {
  return (
    <View style={styles.field}>
      <Text variant="small" style={styles.label} nativeID={rest.nativeID ? `${rest.nativeID}-label` : undefined}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.faint}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? (
        <Text variant="small" color={colors.tomato} accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="muted">{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontFamily: fonts.body700, color: colors.soft, fontSize: 14 },
  input: {
    minHeight: touch.min,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: fonts.body400,
    fontSize: fontSize.input,
  },
  inputError: { borderColor: colors.tomato },
});
