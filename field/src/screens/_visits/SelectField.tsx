import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button, Text } from '@/components';
import { useI18n } from '@/i18n';
import { colors, radius, touch } from '@/theme';
import type { Choice } from './ChoiceList';

/** A `select` from the designs: tap to open the list, pick one. */
export function SelectField<V extends string>({
  label,
  value,
  choices,
  onChange,
  placeholder,
  error,
  testID,
}: {
  label: string;
  value: V | '' | null;
  choices: readonly Choice<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  error?: boolean;
  testID?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = choices.find((c) => c.value === value);
  return (
    <View style={styles.field}>
      <Text variant="small" style={styles.label}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={[styles.box, error && styles.error]}
        testID={testID}
      >
        <Text color={current ? colors.ink : colors.faint}>{current?.label ?? placeholder ?? t('form.choose')}</Text>
        <Text color={colors.soft}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text variant="h2" style={styles.sheetTitle}>
              {label}
            </Text>
            <FlatList
              data={choices as Choice<V>[]}
              keyExtractor={(c) => c.value}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!item.disabled }}
                  disabled={item.disabled}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  style={[styles.option, item.value === value && styles.optionOn, item.disabled && styles.optionOff]}
                  testID={testID ? `${testID}-${item.value}` : undefined}
                >
                  <Text variant={item.value === value ? 'bodyStrong' : 'body'}>{item.label}</Text>
                </Pressable>
              )}
            />
            <Button label={t('common.close')} variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontWeight: '700', color: colors.soft, fontSize: 12 },
  box: {
    minHeight: touch.min,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  error: { borderColor: colors.tomato },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 10, maxHeight: '80%' },
  sheetTitle: { marginBottom: 4 },
  option: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionOn: { backgroundColor: colors.blue100 },
  optionOff: { opacity: 0.5 },
});
