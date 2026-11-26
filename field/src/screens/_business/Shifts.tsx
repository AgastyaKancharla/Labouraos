import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, EmptyState, IconTile, ListRow, LoadingState, Text, TextField } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { errorCode, type BusinessShift } from '@/api/endpoints';
import { formatClock, TimeField } from '@/components/form';
import { useI18n } from '@/i18n';
import { colors, radius, touch } from '@/theme';

/**
 * A time as typed → "HH:MM" (24-hour), or null: "7", "07:00", "7:30",
 * "19:00", "7 AM", "7:30 pm", "12 am" (the server checks too).
 */
export function hhmm(value: string): string | null {
  const m = value.trim().toLowerCase().replace(/\./g, '').match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  }
  return h <= 23 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null;
}

/** 26 Nov (owner): one tap fills a usual shift; the times can still be changed on the clocks. */
export const SHIFT_PRESETS = [
  { key: 'morning', name: 'Morning', startTime: '07:00', endTime: '15:00' },
  { key: 'general', name: 'General', startTime: '09:00', endTime: '18:00' },
  { key: 'day', name: 'Day', startTime: '09:00', endTime: '21:00' },
  { key: 'evening', name: 'Evening', startTime: '15:00', endTime: '23:00' },
  { key: 'night', name: 'Night', startTime: '23:00', endTime: '07:00' },
] as const;

/** A name for a shift left unnamed, from its start time (26 Nov: the "Morning" hint looked filled in). */
export function shiftNameFor(startTime: string): string {
  const h = Number(startTime.slice(0, 2));
  if (h >= 4 && h < 11) return 'Morning';
  if (h >= 11 && h < 15) return 'Day';
  if (h >= 15 && h < 20) return 'Evening';
  return 'Night';
}

export function useBusinessShifts(businessId: string | null | undefined) {
  const { redesign } = useEndpoints();
  return useQuery<BusinessShift[]>({
    queryKey: queryKeys.businessShifts(businessId ?? ''),
    queryFn: () => redesign.shifts(businessId!),
    enabled: Boolean(businessId),
  });
}

/** Add a shift to a business: name, start and end (HH:MM). */
export function AddShiftForm({ businessId, onAdded, onCancel, testID = 'add-shift' }: {
  businessId: string;
  onAdded?: (shift: BusinessShift) => void;
  onCancel?: () => void;
  testID?: string;
}) {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [tried, setTried] = useState(false);
  // 26 Nov: times come from a clock picker (never typed); `hhmm` still reads older typed values.
  const startTime = hhmm(start);
  const endTime = hhmm(end);
  const shiftName = name.trim() || (startTime ? shiftNameFor(startTime) : '');
  const valid = Boolean(shiftName && startTime && endTime && startTime !== endTime);
  const add = useMutation({
    mutationFn: () => redesign.addShift(businessId, { name: shiftName, startTime: startTime!, endTime: endTime! }),
    onSuccess: (shift) => {
      client.setQueryData<BusinessShift[]>(queryKeys.businessShifts(businessId), (list) =>
        [...(list ?? []), shift].sort((a, b) => a.startTime.localeCompare(b.startTime)),
      );
      setName('');
      setStart('');
      setEnd('');
      setTried(false);
      onAdded?.(shift);
    },
  });
  const code = add.error ? errorCode(add.error) : null;
  return (
    <View style={styles.form} testID={testID}>
      <Text variant="small" color={colors.soft}>{t('shifts.quickPick')}</Text>
      <View style={styles.chips}>
        {SHIFT_PRESETS.map((p) => {
          const on = name === p.name && start === p.startTime && end === p.endTime;
          return (
            <Pressable
              key={p.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setName(p.name);
                setStart(p.startTime);
                setEnd(p.endTime);
              }}
              style={[styles.chip, on && styles.chipOn]}
              testID={`${testID}-preset-${p.key}`}
            >
              <Text variant="small" color={on ? colors.white : colors.ink}>{`${p.name} ${formatClock(p.startTime)}–${formatClock(p.endTime)}`}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextField label={t('shifts.name')} value={name} onChangeText={setName} placeholder={t('shifts.namePlaceholder')} hint={t('shifts.nameHint')} maxLength={40} testID={`${testID}-name`} />
      <View style={styles.row}>
        <View style={styles.cell}>
          <TimeField label={t('shifts.start')} value={startTime ?? ''} onChange={setStart} from="00:00" to="23:30" step={30} testID={`${testID}-start`} />
        </View>
        <View style={styles.cell}>
          <TimeField label={t('shifts.end')} value={endTime ?? ''} onChange={setEnd} from="00:00" to="23:30" step={30} testID={`${testID}-end`} />
        </View>
      </View>
      {tried && !valid ? <Text variant="small" color={colors.tomato} testID={`${testID}-invalid`}>{t('shifts.err.invalid')}</Text> : null}
      {add.error ? (
        <Banner tone="error" message={code === 'SHIFT_NAME_TAKEN' ? t('shifts.err.duplicate') : code === 'SHIFT_INVALID' ? t('shifts.err.invalid') : t('shifts.err.generic')} testID={`${testID}-error`} />
      ) : null}
      <View style={styles.row}>
        <Button
          label={t('shifts.save')}
          style={styles.cell}
          loading={add.isPending}
          onPress={() => {
            setTried(true);
            if (valid) add.mutate();
          }}
          testID={`${testID}-save`}
        />
        {onCancel ? <Button label={t('common.cancel')} variant="secondary" style={styles.cell} onPress={onCancel} /> : null}
      </View>
    </View>
  );
}

/** The business page's Shifts card (17 Nov): the list; the account agent adds and removes. */
export function ShiftsCard({ businessId, canEdit }: { businessId: string; canEdit: boolean }) {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const client = useQueryClient();
  const shifts = useBusinessShifts(businessId);
  const [adding, setAdding] = useState(false);
  /** The shift whose Remove was tapped: asked once more before it goes. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (shiftId: string) => redesign.removeShift(businessId, shiftId),
    onSuccess: (_r, shiftId) => {
      setConfirming(null);
      client.setQueryData<BusinessShift[]>(queryKeys.businessShifts(businessId), (list) => (list ?? []).filter((s) => s.id !== shiftId));
    },
  });
  const list = shifts.data ?? [];
  return (
    <Card title={t('shifts.title')} icon="clock" accent="cyan" testID="fa08-shifts">
      {shifts.isPending ? <LoadingState compact /> : null}
      {shifts.isSuccess && list.length === 0 ? <EmptyState compact emoji="🕘" message={t('shifts.none')} /> : null}
      {list.map((s, i) => (
        <View key={s.id}>
          <ListRow
            title={s.label}
            leading={<IconTile icon="clock" accent={s.category === 'night' ? 'navy' : 'gold'} size={30} />}
            trailing={canEdit && confirming !== s.id ? <Button label={t('shifts.delete')} variant="secondary" onPress={() => setConfirming(s.id)} testID={`shift-remove-${s.id}`} /> : undefined}
            last={i === list.length - 1 && !canEdit}
            testID={`shift-${s.id}`}
          />
          {confirming === s.id ? (
            <View style={styles.form} testID={`shift-confirm-${s.id}`}>
              <Text variant="small">{t('shifts.removeConfirm', { shift: s.label })}</Text>
              <View style={styles.row}>
                <Button label={t('shifts.delete')} variant="danger" style={styles.cell} loading={remove.isPending} onPress={() => remove.mutate(s.id)} testID={`shift-remove-yes-${s.id}`} />
                <Button label={t('common.cancel')} variant="secondary" style={styles.cell} onPress={() => setConfirming(null)} />
              </View>
            </View>
          ) : null}
        </View>
      ))}
      {canEdit ? (
        adding ? (
          <AddShiftForm businessId={businessId} onAdded={() => setAdding(false)} onCancel={() => setAdding(false)} />
        ) : (
          <Button label={t('shifts.add')} variant="secondary" onPress={() => setAdding(true)} testID="shift-add" />
        )
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  form: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexBasis: '45%', flexGrow: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.blue, borderColor: colors.blue },
});
