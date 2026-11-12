import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { LeaveBody, LeaveHalf, MyRequest } from '@/api/endpoints';
import { Banner, Button, Card, Screen, Text, TextField } from '@/components';
import { DateField, RadioGroup, SelectField, todayKeyIst } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n, type MessageKey } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner } from '../_selling';
import { dateRange } from '../FA04e-MyAttendance/format';

/** A Team Lead approves up to 3 planned (casual) days in a month for a person (guide, 9 Nov). */
const TEAM_LEAD_PLANNED_DAYS = 3;

/** Where the server sent the request, in his words. */
const ROUTED: Record<string, MessageKey> = {
  team_lead: 'fa04f.sent.teamLead',
  over_limit: 'fa04f.sent.overLimit',
  no_line: 'fa04f.sent.noLine',
};

/**
 * FA04f — Request leave (CA14f-RequestLeave adapted to the phone). Planned
 * (casual) or emergency leave, dates from a calendar (never typed), and a
 * reason. It goes to his Team Lead; more than 3 planned days in a month goes
 * to the Manager by itself (the server decides, and the screen shows where it
 * went). Leave beyond the paid balance counts as unpaid — nothing is blocked.
 * "Full day / Half day — first half / second half" (owner decision 12 Nov, as
 * on CA14f): a half day is one date and half a day of the balance; the other
 * half is worked. Needs signal: the request is sent live, never queued.
 */
export default function RequestLeaveScreen() {
  const { t } = useI18n();
  const { myAttendance } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const balance = useQuery({ queryKey: queryKeys.leaveBalance, queryFn: () => myAttendance.balance() });
  const [kind, setKind] = useState<LeaveBody['kind'] | ''>('');
  const [fromDate, setFrom] = useState('');
  const [toDate, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [half, setHalf] = useState<LeaveHalf | 'full'>('full');
  const halfDay = half === 'full' ? null : half;
  const planMonth = (fromDate || todayKeyIst()).slice(0, 7);
  const month = useQuery({ queryKey: queryKeys.myMonth(planMonth), queryFn: () => myAttendance.month(planMonth) });
  // Planned days already taken this month, half days counting ½.
  const plannedTaken = month.data
    ? month.data.days
        .filter((d) => d.leaveKind && d.leaveKind !== 'emergency' && (d.leaveHalf ? true : d.dayType === 'leave'))
        .reduce((sum, d) => sum + (d.leaveHalf ? 0.5 : 1), 0)
    : null;

  const send = useMutation<MyRequest, Error>({
    mutationFn: () =>
      queue.live(() =>
        myAttendance.requestLeave({
          kind: kind as LeaveBody['kind'],
          fromDate,
          // A half day is one date: "To" is "From".
          toDate: halfDay ? fromDate : toDate || fromDate,
          reason: reason.trim(),
          ...(halfDay ? { half: halfDay } : {}),
        }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.myRequests });
      void client.invalidateQueries({ queryKey: queryKeys.leaveBalance });
      void client.invalidateQueries({ queryKey: ['attendance', 'month'] });
    },
  });
  const ready = !!kind && !!fromDate && (!!halfDay || !toDate || toDate >= fromDate) && reason.trim().length > 0;
  const left = (k: 'casual' | 'emergency') => (balance.data ? String(balance.data[k].left) : t('common.placeholderValue'));

  if (send.data) {
    const r = send.data;
    return (
      <View style={styles.flex} testID="screen-FA04f">
        <AppHeader title={t('fa04f.title')} />
        <Screen>
          <Banner
            tone="ok"
            title={
              r.half
                ? t('fa04f.sentHalfTitle', { date: dateRange(r.fromDate ?? fromDate, r.fromDate ?? fromDate), half: t(r.half === 'first' ? 'fa04f.half.first' : 'fa04f.half.second') })
                : t('fa04f.sentTitle', { dates: dateRange(r.fromDate ?? fromDate, r.toDate ?? (toDate || fromDate)), days: r.days ?? 0 })
            }
            message={t(ROUTED[r.routeReason] ?? 'fa04f.sent.teamLead')}
            testID="fa04f-sent"
          />
          <Text variant="muted">{t('fa04f.smsNote')}</Text>
          <Button label={t('fa04f.backToAttendance')} onPress={() => router.replace(routes.myAttendance)} testID="fa04f-back" />
        </Screen>
      </View>
    );
  }

  return (
    <View style={styles.flex} testID="screen-FA04f">
      <AppHeader title={t('fa04f.title')} />
      <Screen>
        <Card>
          <View style={styles.gap}>
            <SelectField
              label={t('fa04f.type')}
              required
              value={kind}
              onChange={setKind}
              choices={[
                { value: 'casual', label: t('fa04f.casual', { left: left('casual') }) },
                { value: 'emergency', label: t('fa04f.emergency', { left: left('emergency') }) },
              ]}
              testID="fa04f-kind"
            />
            <DateField
              label={t('fa04f.from')}
              required
              value={fromDate}
              onChange={(key) => {
                setFrom(key);
                if (toDate && toDate < key) setTo('');
              }}
              testID="fa04f-from"
            />
            {halfDay ? null : (
              <DateField
                label={t('fa04f.to')}
                required
                value={toDate || fromDate}
                min={fromDate || undefined}
                onChange={setTo}
                hint={t('fa04f.toHint')}
                testID="fa04f-to"
              />
            )}
            <RadioGroup
              label={t('fa04f.halfDay')}
              value={half}
              onChange={setHalf}
              options={[
                { value: 'full', label: t('fa04f.fullDay') },
                { value: 'first', label: t('fa04f.firstHalf') },
                { value: 'second', label: t('fa04f.secondHalf') },
              ]}
              testID="fa04f-half"
            />
            {halfDay ? (
              <Text variant="muted" testID="fa04f-half-hint">
                {t('fa04f.halfHint')}
              </Text>
            ) : null}
            <TextField label={t('fa04f.reason')} value={reason} onChangeText={setReason} multiline numberOfLines={3} testID="fa04f-reason" />
          </View>
        </Card>
        {kind === 'casual' && plannedTaken !== null ? (
          <Banner
            tone="info"
            message={t('fa04f.plannedTaken', { taken: plannedTaken, limit: TEAM_LEAD_PLANNED_DAYS })}
            testID="fa04f-planned"
          />
        ) : null}
        <Banner tone="warn" message={t('fa04f.goesTo')} testID="fa04f-goes-to" />
        <ErrorBanner error={send.error} />
        <View style={styles.buttons}>
          <Button label={t('fa04f.send')} disabled={!ready} loading={send.isPending} onPress={() => send.mutate()} style={styles.half} testID="fa04f-send" />
          <Button label={t('common.cancel')} variant="secondary" onPress={() => router.back()} style={styles.half} testID="fa04f-cancel" />
        </View>
        <Text variant="muted" style={styles.note}>
          {t('fa04f.needsSignal')}
        </Text>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  gap: { gap: 12 },
  buttons: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  note: { textAlign: 'center' },
});
