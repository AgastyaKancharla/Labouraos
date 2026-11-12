import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { CorrectionBody, MyRequest } from '@/api/endpoints';
import { Banner, Button, Card, Screen, Text, TextField } from '@/components';
import { DateField, SelectField, TimeField, todayKeyIst } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n, type MessageKey } from '@/i18n';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner } from '../_selling';
import { formatDateKey } from '../_visits/format';

/** Where the server sent the correction, in his words. */
const ROUTED: Record<string, MessageKey> = {
  team_lead: 'fa04h.sent.teamLead',
  third_correction: 'fa04h.sent.third',
  no_line: 'fa04h.sent.noLine',
};

/**
 * FA04h — Request a correction (CA14h-Correction adapted to the phone). For
 * when something went wrong (system down, forgot to change status): the day
 * from a calendar, the times from a clock in 5-minute steps (never typed), what
 * it should have been and a reason. His Team Lead approves or rejects it with
 * a reason; a third correction in a month goes to the Manager. He can never
 * edit his own times. Needs signal: sent live, never queued.
 */
export default function CorrectionScreen() {
  const { t } = useI18n();
  const { myAttendance } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<CorrectionBody['status']>('available');
  const [reason, setReason] = useState('');
  const send = useMutation<MyRequest, Error>({
    mutationFn: () => queue.live(() => myAttendance.requestCorrection({ date, from, to, status, reason: reason.trim() })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.myRequests });
      void client.invalidateQueries({ queryKey: ['attendance', 'month'] });
    },
  });
  const order = from && to && to <= from ? t('fa04h.toAfterFrom') : null;
  const ready = !!date && !!from && !!to && !order && reason.trim().length > 0;

  if (send.data) {
    const r = send.data;
    return (
      <View style={styles.flex} testID="screen-FA04h">
        <AppHeader title={t('fa04h.title')} />
        <Screen>
          <Banner
            tone="ok"
            title={t('fa04h.sentTitle', { date: formatDateKey(r.date ?? date), from, to })}
            message={t(ROUTED[r.routeReason] ?? 'fa04h.sent.teamLead')}
            testID="fa04h-sent"
          />
          <Button label={t('fa04f.backToAttendance')} onPress={() => router.replace(routes.myAttendance)} testID="fa04h-back" />
        </Screen>
      </View>
    );
  }

  return (
    <View style={styles.flex} testID="screen-FA04h">
      <AppHeader title={t('fa04h.title')} />
      <Screen>
        <Card>
          <View style={styles.gap}>
            <DateField label={t('fa04h.day')} required value={date} max={todayKeyIst()} onChange={setDate} testID="fa04h-date" />
            <View style={styles.row}>
              <View style={styles.half}>
                <TimeField label={t('fa04h.from')} required value={from} onChange={setFrom} from="06:00" to="23:55" step={5} testID="fa04h-from" />
              </View>
              <View style={styles.half}>
                <TimeField label={t('fa04h.to')} required value={to} onChange={setTo} from="06:00" to="23:55" step={5} error={order} testID="fa04h-to" />
              </View>
            </View>
            <SelectField
              label={t('fa04h.shouldHaveBeen')}
              required
              value={status}
              onChange={setStatus}
              choices={[
                { value: 'available', label: t('fa04h.available') },
                { value: 'team_meeting', label: t('status.team_meeting') },
                { value: 'training', label: t('status.training') },
                { value: 'one_to_one', label: t('status.one_to_one') },
              ]}
              testID="fa04h-status"
            />
            <TextField label={t('fa04h.reason')} value={reason} onChangeText={setReason} multiline numberOfLines={3} testID="fa04h-reason" />
          </View>
        </Card>
        <Banner tone="warn" message={t('fa04h.goesTo')} testID="fa04h-goes-to" />
        <ErrorBanner error={send.error} />
        <View style={styles.row}>
          <Button label={t('fa04f.send')} disabled={!ready} loading={send.isPending} onPress={() => send.mutate()} style={styles.half} testID="fa04h-send" />
          <Button label={t('common.cancel')} variant="secondary" onPress={() => router.back()} style={styles.half} testID="fa04h-cancel" />
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
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  note: { textAlign: 'center' },
});
