import { useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useI18n } from '@/i18n';
import { colors, fonts, fontSize, radius, touch } from '@/theme';
import { Text } from '../Text';

/**
 * Form pieces for the field app, following the guide's "Forms: rules for
 * every screen": pickers for dates and times (never typed), ₹ boxes with
 * commas, +91 mobile boxes, ticks and radio rows at least 48 px tall.
 */

export interface Choice<V extends string = string> {
  value: V;
  label: string;
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text variant="small" style={styles.label}>
      {label}
      {required ? <Text style={styles.req}> *</Text> : null}
    </Text>
  );
}

function Hint({ error, hint, testID }: { error?: string | null; hint?: string; testID?: string }) {
  if (error) {
    return (
      <Text variant="small" color={colors.tomato} accessibilityRole="alert" testID={testID ? `${testID}-error` : undefined}>
        {error}
      </Text>
    );
  }
  return hint ? <Text variant="muted">{hint}</Text> : null;
}

/** A picker row that opens a sheet of choices (the `<select>` in the designs). */
export function SelectField<V extends string>({
  label, value, choices, onChange, placeholder, required, error, hint, testID,
}: {
  label: string;
  value: V | '' | null;
  choices: readonly Choice<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  testID?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = choices.find((c) => c.value === value);
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder ?? t('form.choose')}`}
        onPress={() => setOpen(true)}
        style={[styles.box, styles.row, error ? styles.boxError : null]}
        testID={testID}
      >
        <Text style={[styles.value, !current && styles.placeholder]} numberOfLines={1}>
          {current?.label ?? placeholder ?? t('form.choose')}
        </Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>
      <Hint error={error} hint={hint} testID={testID} />
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {choices.map((choice) => (
          <Pressable
            key={choice.value}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: choice.value === value }}
            onPress={() => {
              onChange(choice.value);
              setOpen(false);
            }}
            style={[styles.option, choice.value === value && styles.optionOn]}
            testID={testID ? `${testID}-option-${choice.value}` : undefined}
          >
            <Text style={choice.value === value ? styles.optionTextOn : undefined}>{choice.label}</Text>
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}

function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text variant="label" style={styles.sheetTitle}>
            {title}
          </Text>
          <ScrollView style={styles.sheetList}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** "12,000" from 1200000 paise; "" for null. */
export function rupeesText(paise: number | null): string {
  if (paise === null) return '';
  return Math.round(paise / 100).toLocaleString('en-IN');
}

/** ₹ fixed in front, digits only, commas added; the value is integer paise. */
export function MoneyField({
  label, valuePaise, onChange, required, error, hint, testID,
}: {
  label: string;
  valuePaise: number | null;
  onChange: (paise: number | null) => void;
  required?: boolean;
  error?: string | null;
  hint?: string;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} />
      <View style={[styles.box, styles.row, styles.prefixRow, error ? styles.boxError : null]}>
        <Text style={styles.prefix}>₹</Text>
        <TextInput
          accessibilityLabel={label}
          keyboardType="number-pad"
          inputMode="numeric"
          value={rupeesText(valuePaise)}
          onChangeText={(text) => {
            const digits = text.replace(/\D/g, '').slice(0, 9);
            onChange(digits ? Number(digits) * 100 : null);
          }}
          style={styles.input}
          testID={testID}
        />
      </View>
      <Hint error={error} hint={hint} testID={testID} />
    </View>
  );
}

/** +91 fixed, exactly 10 digits. */
export function MobileField({
  label, value, onChange, required, error, hint, editable = true, testID,
}: {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  required?: boolean;
  error?: string | null;
  hint?: string;
  editable?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} />
      <View style={[styles.box, styles.row, styles.prefixRow, error ? styles.boxError : null, !editable && styles.boxOff]}>
        <Text style={styles.prefix}>+91</Text>
        <TextInput
          accessibilityLabel={label}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={10}
          editable={editable}
          value={value}
          onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, 10))}
          style={styles.input}
          testID={testID}
        />
      </View>
      <Hint error={error} hint={hint} testID={testID} />
    </View>
  );
}

/** A tick box row (48 px). */
export function Checkbox({ label, checked, onChange, disabled, testID }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[styles.check, disabled && styles.disabled]}
      testID={testID}
    >
      <View style={[styles.tick, checked && styles.tickOn]}>{checked ? <Text style={styles.tickMark}>✓</Text> : null}</View>
      <Text style={styles.flex}>{label}</Text>
    </Pressable>
  );
}

/** Radio rows (`.opt` in the designs); the chosen one turns green or red. */
export function RadioGroup<V extends string>({
  label, value, options, onChange, testID,
}: {
  label?: string;
  value: V | null;
  options: readonly (Choice<V> & { tone?: 'ok' | 'bad'; hint?: string })[];
  onChange: (value: V) => void;
  testID?: string;
}) {
  return (
    <View style={styles.field} accessibilityRole="radiogroup">
      {label ? <Text variant="label">{label}</Text> : null}
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={[styles.radio, on && (option.tone === 'bad' ? styles.radioBad : styles.radioOn)]}
            testID={testID ? `${testID}-${option.value}` : undefined}
          >
            <View style={[styles.dot, on && styles.dotOn]}>{on ? <View style={styles.dotInner} /> : null}</View>
            <View style={styles.flex}>
              <Text style={on ? (option.tone === 'bad' ? styles.radioTextBad : styles.radioTextOn) : styles.radioText}>{option.label}</Text>
              {option.hint ? <Text variant="muted">{option.hint}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Two or three buttons side by side (List | Map, ಕನ್ನಡ | हिंदी | English). */
export function Segmented<V extends string>({ value, options, onChange, testID }: {
  value: V;
  options: readonly Choice<V>[];
  onChange: (value: V) => void;
  testID?: string;
}) {
  return (
    <View style={styles.segRow} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.seg, on && styles.segOn]}
            testID={testID ? `${testID}-${o.value}` : undefined}
          >
            <Text style={on ? styles.segTextOn : styles.segText}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Chips with ×, and "+ Add" opening a picker (areas, languages). */
export function ChipPicker({ label, values, choices, onChange, required, error, addLabel, testID }: {
  label: string;
  values: string[];
  choices: readonly Choice[];
  onChange: (values: string[]) => void;
  required?: boolean;
  error?: string | null;
  addLabel: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const left = choices.filter((c) => !values.includes(c.value));
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} />
      <View style={styles.chips}>
        {values.map((v) => (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityLabel={`${choices.find((c) => c.value === v)?.label ?? v} ×`}
            onPress={() => onChange(values.filter((x) => x !== v))}
            style={styles.chip}
          >
            <Text style={styles.chipText}>{choices.find((c) => c.value === v)?.label ?? v} ×</Text>
          </Pressable>
        ))}
        {left.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.chipAdd} testID={testID ? `${testID}-add` : undefined}>
            <Text style={styles.chipAddText}>{addLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      <Hint error={error} testID={testID} />
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {left.map((choice) => (
          <Pressable
            key={choice.value}
            accessibilityRole="menuitem"
            onPress={() => {
              onChange([...values, choice.value]);
              setOpen(false);
            }}
            style={styles.option}
            testID={testID ? `${testID}-option-${choice.value}` : undefined}
          >
            <Text>{choice.label}</Text>
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}

// ------------------------------------------------------------- date & time

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-11-16" → "Mon 16 Nov 2026". */
export function formatDateKey(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Today's date key in IST. */
export function todayKeyIst(now: number = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A calendar picker (never typed). `yearFirst` opens on the year (date of
 * birth); `min`/`max` block dates outside the range (e.g. under 18).
 */
export function DateField({
  label, value, onChange, min, max, yearFirst, required, error, hint, testID,
}: {
  label: string;
  value: string;
  onChange: (key: string) => void;
  min?: string;
  max?: string;
  yearFirst?: boolean;
  required?: boolean;
  error?: string | null;
  hint?: string;
  testID?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const start = value || (max && (!min || max < todayKeyIst()) ? max : min && min > todayKeyIst() ? min : todayKeyIst());
  const [cursor, setCursor] = useState(start.slice(0, 7));
  const [mode, setMode] = useState<'year' | 'day'>(yearFirst ? 'year' : 'day');
  const [y, m] = cursor.split('-').map(Number);
  const days = useMemo(() => {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [...Array.from({ length: first }, () => null), ...Array.from({ length: count }, (_, i) => i + 1)];
  }, [y, m]);
  const allowed = (key: string) => (!min || key >= min) && (!max || key <= max);
  const years = useMemo(() => {
    const top = Number((max ?? addDays(todayKeyIst(), 365 * 2)).slice(0, 4));
    const bottom = Number((min ?? '1940-01-01').slice(0, 4));
    return Array.from({ length: top - bottom + 1 }, (_, i) => top - i);
  }, [min, max]);
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setCursor(d.toISOString().slice(0, 7));
  };
  return (
    <View style={styles.field}>
      <FieldLabel label={label} required={required} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatDateKey(value) : t('form.pickDate')}`}
        onPress={() => {
          setCursor((value || start).slice(0, 7));
          setMode(yearFirst && !value ? 'year' : 'day');
          setOpen(true);
        }}
        style={[styles.box, styles.row, error ? styles.boxError : null]}
        testID={testID}
      >
        <Text style={[styles.value, !value && styles.placeholder]}>{value ? formatDateKey(value) : t('form.pickDate')}</Text>
        <Text style={styles.caret}>📅</Text>
      </Pressable>
      <Hint error={error} hint={hint} testID={testID} />
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {mode === 'year' ? (
          <View style={styles.yearGrid}>
            {years.map((year) => (
              <Pressable
                key={year}
                accessibilityRole="button"
                onPress={() => {
                  setCursor(`${year}-${String(m).padStart(2, '0')}`);
                  setMode('day');
                }}
                style={styles.yearCell}
                testID={testID ? `${testID}-year-${year}` : undefined}
              >
                <Text>{year}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View>
            <View style={styles.calHead}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('form.prevMonth')} onPress={() => shift(-1)} style={styles.calNav}>
                <Text style={styles.calNavText}>‹</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setMode('year')}>
                <Text variant="bodyStrong">{`${MONTHS[m - 1]} ${y}`}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('form.nextMonth')} onPress={() => shift(1)} style={styles.calNav}>
                <Text style={styles.calNavText}>›</Text>
              </Pressable>
            </View>
            <View style={styles.calGrid}>
              {WEEKDAYS.map((w) => (
                <Text key={w} variant="tiny" style={styles.calCell}>
                  {w.slice(0, 2)}
                </Text>
              ))}
              {days.map((day, i) => {
                if (day === null) return <View key={`e${i}`} style={styles.calCell} />;
                const key = `${cursor}-${String(day).padStart(2, '0')}`;
                const ok = allowed(key);
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !ok, selected: key === value }}
                    disabled={!ok}
                    onPress={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                    style={[styles.calCell, styles.calDay, key === value && styles.calDayOn, !ok && styles.disabled]}
                    testID={testID ? `${testID}-day-${key}` : undefined}
                  >
                    <Text style={key === value ? styles.calDayTextOn : undefined}>{day}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </Sheet>
    </View>
  );
}

/** "14:30" → "2:30 PM". */
export function formatClock(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** A clock picker in 15-minute steps by default (never typed). */
export function TimeField({ label, value, onChange, from = '09:00', to = '21:00', step = 15, required, error, testID }: {
  label: string;
  value: string;
  onChange: (hhmm: string) => void;
  from?: string;
  to?: string;
  /** Minutes between choices (corrections use 5). */
  step?: number;
  required?: boolean;
  error?: string | null;
  testID?: string;
}) {
  const choices = useMemo(() => {
    const out: Choice[] = [];
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    for (let min = fh * 60 + fm; min <= th * 60 + tm; min += step) {
      const key = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
      out.push({ value: key, label: formatClock(key) });
    }
    return out;
  }, [from, to, step]);
  return <SelectField label={label} value={value} choices={choices} onChange={onChange} required={required} error={error} testID={testID} />;
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  flex: { flex: 1 },
  label: { fontFamily: fonts.body700, color: colors.soft, fontSize: 12 },
  req: { color: colors.tomato },
  box: {
    minHeight: touch.min,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  boxError: { borderColor: colors.tomato },
  boxOff: { backgroundColor: colors.neutral100 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prefixRow: { paddingLeft: 0, overflow: 'hidden' },
  prefix: {
    fontFamily: fonts.body700,
    color: colors.soft,
    fontSize: fontSize.input,
    paddingHorizontal: 12,
    alignSelf: 'stretch',
    textAlignVertical: 'center',
    lineHeight: touch.min - 2,
    backgroundColor: colors.neutral100,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  input: { flex: 1, fontFamily: fonts.body400, fontSize: fontSize.input, color: colors.ink, minHeight: touch.min - 2, paddingVertical: 8 },
  value: { flex: 1, fontFamily: fonts.body400, fontSize: fontSize.input, color: colors.ink },
  placeholder: { color: colors.faint },
  caret: { color: colors.soft, fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: 16,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  sheetTitle: { marginBottom: 8 },
  sheetList: { flexGrow: 0 },
  option: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.md },
  optionOn: { backgroundColor: colors.blue100 },
  optionTextOn: { color: colors.blue, fontFamily: fonts.body700 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: touch.min },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  tickOn: { backgroundColor: colors.blue, borderColor: colors.blue },
  tickMark: { color: colors.white, fontFamily: fonts.body700, fontSize: 13 },
  disabled: { opacity: 0.45 },
  radio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  radioOn: { borderColor: colors.green, backgroundColor: colors.green100 },
  radioBad: { borderColor: colors.tomato, backgroundColor: colors.tomato100 },
  radioText: { fontFamily: fonts.body600, color: colors.ink },
  radioTextOn: { fontFamily: fonts.body700, color: colors.green },
  radioTextBad: { fontFamily: fonts.body700, color: colors.tomato },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.soft, alignItems: 'center', justifyContent: 'center' },
  dotOn: { borderColor: colors.blue },
  dotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  segRow: { flexDirection: 'row', gap: 6 },
  seg: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segOn: { backgroundColor: colors.blue, borderColor: colors.blue },
  segText: { fontFamily: fonts.body700, color: colors.navy },
  segTextOn: { fontFamily: fonts.body700, color: colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.blue100 },
  chipText: { color: colors.blue, fontFamily: fonts.body700, fontSize: 12.5 },
  chipAdd: {
    paddingHorizontal: 12,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.blue,
  },
  chipAddText: { color: colors.blue, fontFamily: fonts.body700, fontSize: 12.5 },
  yearGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  yearCell: { width: '23%', minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.neutral100 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calNav: { minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center' },
  calNavText: { fontSize: 22, color: colors.blue },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, minHeight: 44, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  calDay: { borderRadius: 22 },
  calDayOn: { backgroundColor: colors.blue },
  calDayTextOn: { color: colors.white, fontFamily: fonts.body700 },
});
