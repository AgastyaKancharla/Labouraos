import { useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { colors, fonts, radius } from '@/theme';
import { Text } from './Text';

interface Props {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  label: string;
  /** Called when all digits are filled. */
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  editable?: boolean;
  testID?: string;
}

/**
 * The `.otp` boxes (FA02 login code, later the owner OTPs). One hidden
 * numeric input drives the boxes, so paste and the iPhone "From Messages"
 * code suggestion both work.
 */
export function CodeInput({ value, onChange, length = 6, label, onComplete, autoFocus, editable = true, testID }: Props) {
  const input = useRef<TextInputInstance>(null);
  const digits = value.split('');
  return (
    <Pressable onPress={() => input.current?.focus()} accessibilityLabel={label} style={styles.wrap}>
      <View style={styles.row} pointerEvents="none">
        {Array.from({ length }, (_, i) => (
          <View key={i} style={[styles.box, i === Math.min(value.length, length - 1) && styles.active]}>
            <Text style={styles.digit}>{digits[i] ?? ''}</Text>
          </View>
        ))}
      </View>
      <TextInput
        ref={input}
        testID={testID}
        value={value}
        editable={editable}
        onChangeText={(text) => {
          const clean = text.replace(/\D/g, '').slice(0, length);
          onChange(clean);
          if (clean.length === length) onComplete?.(clean);
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={length}
        autoFocus={autoFocus}
        accessibilityLabel={label}
        style={styles.hidden}
        caretHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  row: { flexDirection: 'row', gap: 6 },
  // Boxes share the width, so six always fit on a small phone with large text.
  box: {
    flex: 1,
    maxWidth: 52,
    height: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: { borderColor: colors.blue },
  digit: { fontFamily: fonts.display700, fontSize: 22, color: colors.ink },
  hidden: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.02, fontSize: 16 },
});
