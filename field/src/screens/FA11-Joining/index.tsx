import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { CallRow, PlacementView } from '@/api/endpoints';
import { Banner, Button, Card, Screen, StatusChip, Text } from '@/components';
import { addDays, DateField, RadioGroup, todayKeyIst } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { formatCountdown, formatDayIst } from '@/lib/format';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner, KeyValue, Note, QueryView, StepRow, useParam } from '../_selling';
import { isPaid } from '../FA15q-Paid';

type OwnerSays = 'joined' | 'didnt_come' | 'moved';

/**
 * FA11 — Confirm joining. After the business pays, joining is confirmed by
 * recorded calls to both the worker and the owner (needs signal). Owner says:
 * he joined (POST /placements/:id/joined — only when both calls were
 * answered; nobody types a joining date), he didn't come (the worker is
 * called; if he isn't joining the business gets a free replacement search),
 * or joining moved to another date (both are told). Then the 60-day
 * guarantee starts and the check-ins follow.
 */
export default function JoiningScreen() {
  const { t } = useI18n();
  const id = useParam('id');
  const { selling } = useEndpoints();
  const placement = useQuery({ queryKey: queryKeys.sellingPlacement(id), queryFn: () => selling.placement(id), enabled: !!id });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa11.subtitle')} />
      <Screen testID="screen-FA11" onRefresh={() => void placement.refetch()} refreshing={placement.isRefetching}>
        <QueryView query={placement}>{(p) => <Joining placement={p} />}</QueryView>
      </Screen>
    </View>
  );
}

function callChip(call: CallRow | null, t: ReturnType<typeof useI18n>['t']) {
  if (!call) return { label: t('fa11.notCalled'), tone: 'neutral' as const };
  if (!call.answered) return { label: t('fa11.notAnswered'), tone: 'amber' as const };
  return { label: call.durationSec ? t('fa11.answeredFor', { time: formatCountdown(call.durationSec * 1000) }) : t('fa11.answered'), tone: 'green' as const };
}

function Joining({ placement: p }: { placement: PlacementView }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const [says, setSays] = useState<OwnerSays | null>(null);
  const [newDate, setNewDate] = useState('');
  const [saved, setSaved] = useState<'sent' | 'queued' | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.sellingPlacement(p.id) });
  const call = useMutation({
    mutationFn: (who: 'job_seeker' | 'business') =>
      queue.live(() =>
        selling.placeCall({
          subjectType: who,
          subjectId: who === 'job_seeker' ? p.candidate.id : p.business.id,
          purpose: 'joining_confirmation',
          relatedType: 'placement',
          relatedId: p.id,
        }),
      ),
    onSuccess: () => void refresh(),
  });
  const save = useMutation({
    mutationFn: () =>
      says === 'joined'
        ? queue.submit(t('fa11.queuedLabel', { name: p.candidate.firstName }), { method: 'POST', path: `/placements/${encodeURIComponent(p.id)}/joined`, json: {} })
        : queue.submit(t('fa11.queuedLabel', { name: p.candidate.firstName }), {
          method: 'POST',
          path: `/field-selling/placements/${encodeURIComponent(p.id)}/owner-says`,
          json: { answer: says, ...(says === 'moved' ? { newJoiningDate: newDate } : {}) },
        }),
    onSuccess: (r) => {
      setSaved(r.status);
      void refresh();
    },
  });
  const paid = isPaid(p);
  const worker = callChip(p.workerCall, t);
  const owner = callChip(p.ownerCall, t);
  const bothAnswered = p.workerCall?.answered && p.ownerCall?.answered;
  const ready = says === 'joined' ? !!bothAnswered : says === 'didnt_come' ? !!p.ownerCall?.answered : says === 'moved' ? !!p.ownerCall?.answered && !!newDate : false;
  return (
    <>
      <Text variant="h2" style={styles.title}>{t('fa11.title', { name: p.candidate.firstName, business: p.business.name })}</Text>
      {p.joinedDate ? <Banner tone="ok" message={t('fa11.joinedOn', { date: formatDayIst(p.joinedDate) })} testID="joined" /> : null}
      <Card>
        <KeyValue
          label={t('fa11.feePaid', { business: p.business.name })}
          trailing={<StatusChip label={paid ? t('fa11.byBank') : t('fa11.notPaid')} tone={paid ? 'green' : 'amber'} />}
        />
        <KeyValue label={t('fa11.joiningDate')} value={p.joiningDate ? formatDayIst(p.joiningDate) : '—'} strong />
        <KeyValue
          label={t('fa11.callWorker', { name: p.candidate.firstName })}
          trailing={
            <View style={styles.callCell}>
              <StatusChip label={worker.label} tone={worker.tone} />
              <Button label={t('fa11.call')} variant="secondary" disabled={!paid} onPress={() => call.mutate('job_seeker')} testID="call-worker" />
            </View>
          }
        />
        <KeyValue
          label={t('fa11.callOwner')}
          last
          trailing={
            <View style={styles.callCell}>
              <StatusChip label={owner.label} tone={owner.tone} />
              <Button label={t('fa11.call')} variant="secondary" disabled={!paid} onPress={() => call.mutate('business')} testID="call-owner" />
            </View>
          }
        />
      </Card>
      <ErrorBanner error={call.error} />
      {!p.joinedDate && !saved ? (
        <>
          <RadioGroup
            label={t('fa11.ownerSays')}
            value={says}
            onChange={setSays}
            testID="owner-says"
            options={[
              { value: 'joined', label: t('fa11.joinedToday') },
              { value: 'didnt_come', label: t('fa11.didntCome'), tone: 'bad' },
              { value: 'moved', label: t('fa11.moved') },
            ]}
          />
          {says === 'moved' ? (
            <DateField label={t('fa11.newDate')} required value={newDate} onChange={setNewDate} min={addDays(todayKeyIst(), 1)} testID="new-date" />
          ) : null}
          <Note>{t('fa11.rules')}</Note>
          <Button label={t('fa11.save')} disabled={!ready} loading={save.isPending} onPress={() => save.mutate()} testID="save" />
          <ErrorBanner error={save.error} />
        </>
      ) : saved ? (
        <Banner tone={saved === 'sent' ? 'ok' : 'info'} message={saved === 'sent' ? t('fa11.saved') : t('fa03.waitingToSend')} testID="saved" />
      ) : null}
      <Text variant="muted">{t('fa11.guaranteeNote')}</Text>
      <Card title={t('fa11.comingUp')}>
        <StepRow label={t('fa11.day7', { name: p.candidate.firstName })} chip={p.comingUp.dayCheckIn7 ? formatDayIst(p.comingUp.dayCheckIn7).slice(4) : '—'} />
        <StepRow label={t('fa11.day30')} chip={p.comingUp.dayCheckIn30 ? formatDayIst(p.comingUp.dayCheckIn30).slice(4) : '—'} />
        <StepRow label={t('fa11.complete')} chip={p.comingUp.completesAt ? formatDayIst(p.comingUp.completesAt).slice(4) : '—'} last />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 17 },
  callCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
