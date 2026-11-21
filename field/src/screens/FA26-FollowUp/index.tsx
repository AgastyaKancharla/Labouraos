import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, Icon, LoadingState, Screen, StatusChip, Text, TextField } from '@/components';
import { RadioGroup } from '@/components/form';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAfterSave } from '@/api/refresh';
import type { FollowUpView } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatDayIst } from '@/lib/format';
import { pageRoutes, sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner } from '../_selling';

/** How often the screen asks the phone system whether the call was answered. */
export const CALL_POLL_MS = 3_000;

/**
 * FA26 — a follow-up task (21 Nov, M4): repeat business day 30 / day 61 and
 * the other follow-ups assigned to the field agent. Its kind label ("Repeat
 * business — day 30"), Call owner (the masked, recorded call, purpose
 * follow_up), what they said, and Done (POST /follow-up-tasks/:id/complete
 * with the answered call). A call nobody answered leaves the task open.
 * "Needs more staff" offers Add the vacancy next. Data: GET /field-work/follow-ups/:id.
 */
export default function FollowUpScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { fieldOps } = useEndpoints();
  const q = useQuery({ queryKey: queryKeys.followUp(id ?? ''), queryFn: () => fieldOps.followUp(id!), enabled: Boolean(id) });
  return (
    <View style={styles.flex} testID="screen-FA26">
      <AppHeader title={t('fu.title')} subtitle={q.data?.kindLabel} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        {!id ? (
          <EmptyState message={t('common.error')} />
        ) : q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <FollowUp task={q.data} />
        )}
      </Screen>
    </View>
  );
}

function FollowUp({ task }: { task: FollowUpView }) {
  const { t } = useI18n();
  const { selling, fieldOps } = useEndpoints();
  const queue = useOfflineQueue();
  const afterSave = useAfterSave();
  const [callId, setCallId] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(task.status === 'done');
  const call = useQuery({
    queryKey: queryKeys.call(callId ?? ''),
    queryFn: () => selling.call(callId!),
    enabled: Boolean(callId),
    refetchInterval: (query) => (query.state.data?.answered ? false : CALL_POLL_MS),
  });
  const place = useMutation({
    mutationFn: () =>
      queue.live(() =>
        selling.placeCall({
          subjectType: task.subjectType === 'business' ? 'business' : 'job_seeker',
          subjectId: task.subjectId,
          purpose: task.callPurpose,
        }),
      ),
    onSuccess: (r) => setCallId(r.callRecordId),
  });
  const complete = useMutation({
    mutationFn: () => queue.live(() => fieldOps.completeFollowUp(task.id, { callRecordId: callId!, answer: answer!, ...(notes.trim() ? { notes: notes.trim() } : {}) })),
    onSuccess: () => {
      setDone(true);
      afterSave(['field-work']);
    },
  });
  const who = task.business?.contactName ?? task.business?.name ?? task.jobSeeker?.firstName ?? '';
  const answered = Boolean(call.data?.answered);
  return (
    <>
      <Card stripe accent="royal" testID="fu-card">
        <View style={styles.head}>
          <Text variant="bodyStrong" style={styles.flex1}>{task.business?.name ?? task.jobSeeker?.firstName ?? task.code}</Text>
          <StatusChip tone="blue" label={task.kindLabel} />
        </View>
        <Text variant="muted">{[task.code, t('fu.due', { date: formatDayIst(task.dueAt) })].join(' · ')}</Text>
        {task.business ? <Text variant="muted">{t('job.phone', { last4: task.business.phoneLast4 })}</Text> : null}
        {task.jobSeeker ? <Text variant="muted">{t('job.phone', { last4: task.jobSeeker.phoneLast4 })}</Text> : null}
      </Card>
      {done ? (
        <>
          <Banner tone="ok" message={task.status === 'done' && !complete.isSuccess ? t('fu.alreadyDone') : t('fu.saved')} testID="fu-done" />
          {answer === 'needs_more_staff' && task.business ? (
            <Button label={t('fu.addVacancy')} onPress={() => router.replace(sellingRoutes.addVacancy(task.business!.id))} testID="fu-add-vacancy" />
          ) : null}
          {task.business ? (
            <Button label={t('fu.openBusiness')} variant="secondary" onPress={() => router.push(pageRoutes.business(task.business!.id))} testID="fu-open-business" />
          ) : null}
        </>
      ) : (
        <>
          <Button
            label={who ? t('fu.call', { name: who }) : t('fu.callBusiness')}
            icon={<Icon name="phone" color={colors.white} />}
            loading={place.isPending}
            onPress={() => place.mutate()}
            testID="fu-call"
          />
          <ErrorBanner error={place.error} />
          {callId && !answered ? <Banner tone="info" icon="phone" message={t('fu.calling')} testID="fu-calling" /> : null}
          {callId && !answered && call.data && call.data.endedAt ? <Banner tone="warn" message={t('fu.notAnswered')} testID="fu-not-answered" /> : null}
          {answered ? (
            <>
              <RadioGroup
                label={t('fu.result')}
                value={answer}
                onChange={setAnswer}
                testID="fu-answer"
                options={task.answers.map((a) => ({ value: a, label: t(`fu.answer.${a}` as MessageKey) }))}
              />
              <TextField label={t('fu.notes')} value={notes} onChangeText={setNotes} multiline testID="fu-notes" />
              <ErrorBanner error={complete.error} />
              <Button label={t('fu.done')} disabled={!answer} loading={complete.isPending} onPress={() => complete.mutate()} testID="fu-complete" />
            </>
          ) : null}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
});
