import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { errorText } from '@/api/errorText';
import { queryKeys } from '@/api/queryClient';
import type { BusinessShift } from '@/api/types';
import { Banner, Button, Card, IconTile, ListRow, Text, TextField } from '@/components';
import { useI18n } from '@/i18n';
import { colors } from '@/theme';

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

export function useShifts(profileId: string | null) {
  const api = useCustomerApi();
  return useQuery<BusinessShift[]>({ queryKey: queryKeys.shifts(profileId ?? ''), queryFn: () => api.shifts(profileId!), enabled: Boolean(profileId) });
}

/** Add a shift: name, start and end (HH:MM). */
export function AddShiftForm({ profileId, onAdded, onCancel, testID = 'add-shift' }: {
  profileId: string;
  onAdded?: (shift: BusinessShift) => void;
  onCancel?: () => void;
  testID?: string;
}) {
  const { t } = useI18n();
  const api = useCustomerApi();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [tried, setTried] = useState(false);
  const startTime = hhmm(start);
  const endTime = hhmm(end);
  const valid = Boolean(name.trim() && startTime && endTime && startTime !== endTime);
  const add = useMutation({
    mutationFn: () => api.addShift(profileId, { name: name.trim(), startTime: startTime!, endTime: endTime! }),
    onSuccess: (shift) => {
      client.setQueryData<BusinessShift[]>(queryKeys.shifts(profileId), (list) => [...(list ?? []), shift].sort((a, b) => a.startTime.localeCompare(b.startTime)));
      setName('');
      setStart('');
      setEnd('');
      setTried(false);
      onAdded?.(shift);
    },
  });
  return (
    <View style={styles.form} testID={testID}>
      <TextField label={t('shifts.name')} value={name} onChangeText={setName} placeholder={t('shifts.namePlaceholder')} maxLength={40} testID={`${testID}-name`} />
      <View style={styles.row}>
        <View style={styles.cell}>
          <TextField label={t('shifts.start')} value={start} onChangeText={setStart} placeholder="07:00" maxLength={8} testID={`${testID}-start`} />
        </View>
        <View style={styles.cell}>
          <TextField label={t('shifts.end')} value={end} onChangeText={setEnd} placeholder="15:00" maxLength={8} testID={`${testID}-end`} />
        </View>
      </View>
      {tried && !valid ? <Text variant="small" style={styles.error} testID={`${testID}-invalid`}>{t('shifts.invalid')}</Text> : null}
      {add.error ? <Banner tone="error" message={errorText(t, add.error)} testID={`${testID}-error`} /> : null}
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

/** Business Home's "Your shifts" (17 Nov): the owner adds and removes his business's shifts. */
export function ShiftsCard({ profileId }: { profileId: string }) {
  const { t } = useI18n();
  const api = useCustomerApi();
  const client = useQueryClient();
  const shifts = useShifts(profileId);
  const [adding, setAdding] = useState(false);
  /** The shift whose Remove was tapped: asked once more before it goes. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (shiftId: string) => api.removeShift(profileId, shiftId),
    onSuccess: (_r, shiftId) => {
      setConfirming(null);
      client.setQueryData<BusinessShift[]>(queryKeys.shifts(profileId), (list) => (list ?? []).filter((s) => s.id !== shiftId));
    },
  });
  const list = shifts.data ?? [];
  return (
    <Card title={t('shifts.title')} accent="cyan" testID="shifts-card">
      <Text variant="muted">{list.length === 0 && shifts.isSuccess ? t('shifts.none') : t('shifts.intro')}</Text>
      {list.map((s, i) => (
        <View key={s.id}>
          <ListRow
            title={s.label}
            leading={<IconTile icon="clock" accent={s.category === 'night' ? 'navy' : 'gold'} size={30} />}
            trailing={confirming !== s.id ? <Button label={t('shifts.remove')} variant="secondary" onPress={() => setConfirming(s.id)} testID={`shift-remove-${s.id}`} /> : undefined}
            last={i === list.length - 1}
            testID={`shift-${s.id}`}
          />
          {confirming === s.id ? (
            <View style={styles.form} testID={`shift-confirm-${s.id}`}>
              <Text variant="small">{t('shifts.removeConfirm', { shift: s.label })}</Text>
              <View style={styles.row}>
                <Button label={t('shifts.remove')} variant="danger" style={styles.cell} loading={remove.isPending} onPress={() => remove.mutate(s.id)} testID={`shift-remove-yes-${s.id}`} />
                <Button label={t('common.cancel')} variant="secondary" style={styles.cell} onPress={() => setConfirming(null)} />
              </View>
            </View>
          ) : null}
          {remove.error && confirming === s.id ? <Banner tone="error" message={errorText(t, remove.error)} /> : null}
        </View>
      ))}
      {adding ? (
        <AddShiftForm profileId={profileId} onAdded={() => setAdding(false)} onCancel={() => setAdding(false)} />
      ) : (
        <Button label={t('shifts.add')} variant="secondary" onPress={() => setAdding(true)} testID="shift-add" />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  form: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexBasis: '45%', flexGrow: 1 },
  error: { color: colors.tomato },
});
