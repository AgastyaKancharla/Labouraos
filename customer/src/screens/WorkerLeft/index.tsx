import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { errorText } from '@/api/errorText';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryClient';
import type { PlacedWorker, WorkerLeftReport, WorkerState } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, EmptyState, ErrorState, IconTile, ListRow, LoadingState, Screen, StatusChip, Text, TextField } from '@/components';
import { DateField, RadioGroup, formatDateKey } from '@/components/form';
import { useI18n, type MessageKey } from '@/i18n';
import type { Tone } from '@/theme';

const STATE_TONE: Record<WorkerState, Tone> = {
  can_report: 'green',
  reported: 'amber',
  claim_open: 'cyan',
  not_again: 'neutral',
  guarantee_over: 'neutral',
  not_started: 'neutral',
};

/** The words for a reason key (the staff form's closed list, contract 8.2). Unknown keys show as they are. */
function reasonLabel(t: (key: MessageKey) => string, reason: string): string {
  const key = `workerReason.${reason}` as MessageKey;
  const text = t(key);
  return text === key ? reason : text;
}

function reportStatus(t: (key: MessageKey) => string, r: WorkerLeftReport): { label: string; tone: Tone } {
  if (r.status === 'open') return { label: t('workers.reportOpen'), tone: 'amber' };
  if (r.status === 'claim_filed' && r.claimDecision === 'accepted') return { label: t('workers.reportAccepted'), tone: 'green' };
  if (r.status === 'claim_filed' && r.claimDecision === 'rejected') return { label: t('workers.reportRejected'), tone: 'tomato' };
  if (r.status === 'claim_filed') return { label: t('workers.reportWithTeamLead'), tone: 'cyan' };
  return { label: t('workers.reportClosed'), tone: 'neutral' };
}

/**
 * "A worker left" (Master Guide, customer app 14 Nov; contract 8.2). The
 * business picks the worker, the day he left and why; our call team calls to
 * confirm and files the claim, and a Team Lead decides the free replacement.
 * Only first names, never a phone number or money.
 */
export default function WorkerLeft() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const client = useQueryClient();
  const { activeProfile } = useAuth();
  const profileId = activeProfile?.kind === 'business' ? activeProfile.id : null;
  const workers = useQuery({ queryKey: queryKeys.workers(profileId ?? ''), queryFn: () => api.workers(profileId!), enabled: Boolean(profileId) });
  const [picked, setPicked] = useState<PlacedWorker | null>(null);
  const [leftOn, setLeftOn] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const pick = (worker: PlacedWorker) => {
    setPicked(worker);
    setLeftOn('');
    setReason(null);
    setNote('');
    setProblem(null);
    setDone(false);
  };

  const submit = async () => {
    if (!profileId || !picked) return;
    if (!leftOn || !reason) {
      setProblem(t('form.fixMarked'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api.reportWorkerLeft(profileId, picked.placementId, { workerLeftOn: leftOn, reason, note: note.trim() || null });
      setDone(true);
      setPicked(null);
      await client.invalidateQueries({ queryKey: queryKeys.workers(profileId) });
      await client.invalidateQueries({ queryKey: queryKeys.home(profileId) });
    } catch (e) {
      setProblem(isApiError(e) && e.code === 'PROFILE_NOT_FOUND' ? t('workers.notFound') : errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const header = <AppHeader title={t('workers.title')} onBack={() => (picked ? setPicked(null) : router.back())} showAccountActions />;
  if (!profileId) {
    return (
      <View style={styles.flex} testID="workers">
        {header}
        <Screen>
          <EmptyState message={t('workers.businessOnly')} />
        </Screen>
      </View>
    );
  }
  if (workers.isLoading) {
    return (
      <View style={styles.flex} testID="workers">
        {header}
        <LoadingState />
      </View>
    );
  }
  if (workers.isError || !workers.data) {
    return (
      <View style={styles.flex} testID="workers">
        {header}
        <ErrorState error={workers.error} onRetry={() => void workers.refetch()} />
      </View>
    );
  }
  const data = workers.data;
  const reasons = picked?.neverJoined
    ? data.reasons.neverJoined.map((r) => ({ value: r, label: reasonLabel(t, r), tone: 'ok' as const }))
    : [
        ...data.reasons.covered.map((r) => ({ value: r, label: reasonLabel(t, r), tone: 'ok' as const, hint: t('workers.covered') })),
        ...data.reasons.notCovered.map((r) => ({ value: r, label: reasonLabel(t, r), tone: 'bad' as const, hint: t('workers.notCovered') })),
      ];

  return (
    <View style={styles.flex} testID="workers">
      {header}
      <Screen>
        {done ? <Banner tone="ok" title={t('workers.doneTitle')} message={t('workers.done')} testID="workers-done" /> : null}

        {!data.open ? <Banner tone="info" message={t('workers.notOpen')} testID="workers-closed" /> : null}

        {picked && data.open ? (
          <Card title={t('workers.formTitle', { name: picked.workerFirstName ?? picked.placementCode })} accent="orange" emoji="📝" testID="workers-form">
            <View style={styles.gap}>
              <Text variant="muted">{t('workers.formIntro', { days: data.reportWithinDays })}</Text>
              <DateField
                label={picked.neverJoined ? t('workers.neverCameOn') : t('workers.leftOn')}
                value={leftOn}
                onChange={setLeftOn}
                min={picked.leftOnEarliest ?? undefined}
                max={picked.leftOnLatest}
                required
                testID="workers-left-on"
              />
              <RadioGroup label={t('workers.why')} value={reason} onChange={setReason} options={reasons} testID="workers-reason" />
              <TextField
                label={t('workers.note')}
                value={note}
                onChangeText={setNote}
                maxLength={200}
                multiline
                hint={t('workers.noteHint')}
                testID="workers-note"
              />
              {problem ? <Banner tone="error" message={problem} testID="workers-problem" /> : null}
              <Button label={t('workers.submit')} onPress={() => void submit()} loading={busy} testID="workers-submit" />
              <Button label={t('common.cancel')} variant="secondary" onPress={() => setPicked(null)} testID="workers-cancel" />
            </View>
          </Card>
        ) : (
          <Card title={t('workers.pickTitle')} accent="royal" emoji="👷" testID="workers-list">
            <Text variant="muted">{t('workers.intro', { days: data.reportWithinDays, window: data.windowDays })}</Text>
            {data.workers.length === 0 ? <EmptyState compact emoji="🧑‍🍳" message={t('workers.none')} /> : null}
            {data.workers.map((w, i) => (
              <ListRow
                key={w.placementId}
                leading={<IconTile icon="users" accent={w.state === 'can_report' ? 'good' : 'navy'} size={34} round />}
                title={`${w.workerFirstName ?? '—'} · ${w.trade}`}
                subtitle={[
                  w.placementCode,
                  w.joinedOn ? t('workers.joined', { day: formatDateKey(w.joinedOn) }) : null,
                  w.guaranteeLastDay ? t('workers.until', { day: formatDateKey(w.guaranteeLastDay) }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={<StatusChip label={t(`workers.state.${w.state}` as MessageKey)} tone={STATE_TONE[w.state]} />}
                onPress={w.state === 'can_report' && data.open ? () => pick(w) : undefined}
                last={i === data.workers.length - 1}
                testID={`workers-row-${w.placementCode}`}
              />
            ))}
          </Card>
        )}

        {data.reports.length > 0 ? (
          <Card title={t('workers.reportsTitle')} accent="gold" emoji="📋" testID="workers-reports">
            {data.reports.map((r, i) => {
              const status = reportStatus(t, r);
              return (
                <ListRow
                  key={r.id}
                  title={`${r.workerFirstName ?? '—'}${r.placementCode ? ` · ${r.placementCode}` : ''}`}
                  subtitle={[r.workerLeftOn ? t('workers.leftOnDay', { day: formatDateKey(r.workerLeftOn) }) : null, reasonLabel(t, r.reason)].filter(Boolean).join(' · ')}
                  trailing={<StatusChip label={status.label} tone={status.tone} />}
                  last={i === data.reports.length - 1}
                  testID={`workers-report-${r.id}`}
                />
              );
            })}
          </Card>
        ) : null}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 14 } });
