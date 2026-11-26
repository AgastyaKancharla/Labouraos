import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button, Text, TextField } from '@/components';
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
  searchable = false,
  testID,
}: {
  label: string;
  value: V | '' | null;
  choices: readonly Choice<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  error?: boolean;
  /** A search box over the list (22 Nov: the long grouped list of business types). */
  searchable?: boolean;
  testID?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = choices.find((c) => c.value === value);
  // Closing clears the search, so the list opens whole next time.
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  // Group headings (choices with `group`), filtered by the search words.
  const q = query.trim().toLowerCase();
  const shown = q ? choices.filter((c) => c.label.toLowerCase().includes(q) || (c.group ?? '').toLowerCase().includes(q)) : choices;
  type Row = { kind: 'heading'; key: string; label: string } | { kind: 'choice'; key: string; choice: Choice<V> };
  const rows: Row[] = [];
  let lastGroup: string | undefined;
  for (const c of shown) {
    if (c.group && c.group !== lastGroup) rows.push({ kind: 'heading', key: `h:${c.group}`, label: c.group });
    lastGroup = c.group;
    rows.push({ kind: 'choice', key: c.value, choice: c });
  }
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
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        {/*
          26 Nov fix: the backdrop is a layer BEHIND the sheet, not its parent. As the parent, a tap in the
          search box (web app) reached the backdrop and closed the list before anything could be typed.
        */}
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            testID={testID ? `${testID}-backdrop` : undefined}
          />
          <View style={styles.sheet}>
            <Text variant="h2" style={styles.sheetTitle}>
              {label}
            </Text>
            {searchable ? (
              <TextField label={t('form.search')} value={query} onChangeText={setQuery} autoCorrect={false} testID={testID ? `${testID}-search` : undefined} />
            ) : null}
            <FlatList
              data={rows}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(r) => r.key}
              ListEmptyComponent={<Text variant="muted">{t('form.noMatch')}</Text>}
              renderItem={({ item: row }) => {
                if (row.kind === 'heading') {
                  return (
                    <Text variant="label" style={styles.heading} testID={testID ? `${testID}-group-${row.label}` : undefined}>
                      {row.label}
                    </Text>
                  );
                }
                const item = row.choice;
                return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!item.disabled }}
                  disabled={item.disabled}
                  onPress={() => {
                    onChange(item.value);
                    close();
                  }}
                  style={[styles.option, item.value === value && styles.optionOn, item.disabled && styles.optionOff]}
                  testID={testID ? `${testID}-${item.value}` : undefined}
                >
                  <Text variant={item.value === value ? 'bodyStrong' : 'body'}>{item.label}</Text>
                </Pressable>
                );
              }}
            />
            <Button label={t('common.close')} variant="secondary" onPress={close} />
          </View>
        </View>
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
  heading: { paddingTop: 12, paddingBottom: 4, paddingHorizontal: 8 },
});
