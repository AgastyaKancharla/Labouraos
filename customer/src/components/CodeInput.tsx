import { useRef } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
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
 * numeric input drives the boxes, so paste and the phone's own code
 * suggestion both work: Android's keyboard offers the code from the SMS
 * (`sms-otp`), the iPhone shows "From Messages" (`one-time-code`). One tap
 * fills all six boxes and `onComplete` carries on by itself.
 */
export function CodeInput({ value, onChange, length = 6, label, onComplete, autoFocus, editable = true, testID }: Props) {
  const input = useRef<TextInputInstance>(null);
  const digits = value.split('');
  return (
    <Pressable onPress={() => input.current?.focus()} accessibilityLabel={label} style={styles.wrap}>
      <View style={styles.row} pointerEvents="none">
        {Array.from({ length }, (_, i) => (
          <View key={i} style={[styles.box, i < value.length && styles.filled, i === Math.min(value.length, length - 1) && styles.active]}>
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
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
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
    maxWidth: 54,
    height: 60,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 2px rgba(3,43,115,0.05)',
  },
  filled: { borderColor: '#9DB8E6', boxShadow: '0 6px 14px -8px rgba(0,85,192,0.55)' },
  active: { borderColor: colors.blue, borderWidth: 2, boxShadow: '0 0 0 4px rgba(0,85,192,0.14)' },
  digit: { fontFamily: fonts.display700, fontSize: 22, color: colors.ink },
  hidden: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.02, fontSize: 16 },
});
