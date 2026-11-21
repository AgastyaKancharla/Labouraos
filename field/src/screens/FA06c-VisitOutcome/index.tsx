import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, Emoji, EmptyState, ErrorState, LoadingState, Screen, Text, TextField, type IconName } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import { errorCode, visitPaths } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { useFormDraft } from '@/lib/formDraft';
import { TimeField } from '@/components/form';
import { pageRoutes, routes } from '@/navigation/routes';
import { finishLater } from '@/navigation/useFlow';
import { type Accent, colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ChoiceList } from '../_visits/ChoiceList';
import { DatePicker } from '../_visits/DatePicker';
import { useDraft } from '../_visits/visitDraft';

/** The results picked here. Onboarded is never picked: saving the business form sets it. */
export const PICKED_OUTCOMES = ['interested_later', 'not_interested', 'owner_not_there'] as const;
export type PickedOutcome = (typeof PICKED_OUTCOMES)[number];
/** Each outcome's colour code: come back cyan, not interested orange, owner away gold. */
export const OUTCOME_LOOK: Record<PickedOutcome, { icon: IconName; accent: Accent }> = {
  interested_later: { icon: 'calendar', accent: 'cyan' },
  not_interested: { icon: 'x-circle', accent: 'orange' },
  owner_not_there: { icon: 'clock', accent: 'gold' },
};
export const REASONS = ['hires_family_friends', 'fee_too_high', 'no_staff_needed', 'other_agency', 'other'] as const;

/**
 * FA06c — How did the visit go? For a visit that did not end in onboarding:
 * interested — come back later (date); not interested (reason); owner not
 * there (date). "Come back" visits reappear in Needs you now on that date.
 * Saved through the offline queue.
 *
 * Redesign (16 Nov): the visit is always read fresh from the server, and a
 * visit that already has a result (onboarded or any other) never opens this
 * question again: it goes to the visit details page, where a result other
 * than Onboarded can be changed with a reason.
 */
export default function VisitOutcomeScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ id?: string; outcome?: string }>();
  const id = params.id ?? '';
  const draft = useDraft(id || undefined);
  const { visits } = useEndpoints();
  const server = useQuery({
    queryKey: queryKeys.visit(id),
    queryFn: () => visits.get(id),
    enabled: Boolean(id),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const finished = Boolean(server.data?.outcome);
  useEffect(() => {
    if (finished) router.replace(pageRoutes.visitDetails(id));
  }, [finished, id]);

  if (!id) return <EmptyState message={t('common.error')} />;
  // Fresh from the server; only without signal does the phone's copy of the visit stand in.
  if (server.isPending || finished) return <LoadingState />;
  if (server.isError && !draft) return <ErrorState error={server.error} onRetry={() => void server.refetch()} />;
  const v = server.data;
  const visit = {
    id,
    name: v?.business?.name ?? draft?.businessName ?? (draft?.shopName || v?.shopName) ?? '',
    hasBusiness: Boolean(v?.business ?? draft?.businessId),
    shopName: draft?.shopName || v?.shopName || '',
    spokeTo: draft?.spokeTo || v?.spokeTo || '',
    contactPhone: draft?.contactPhone ?? '',
    endedAt: draft?.endedAt ?? v?.endedAt ?? null,
  };
  return <OutcomeForm visit={visit} initial={params.outcome} />;
}

function OutcomeForm({ visit, initial }: {
  visit: { id: string; name: string; hasBusiness: boolean; shopName: string; spokeTo: string; contactPhone: string; endedAt: string | null };
  initial?: string;
}) {
  const { t } = useI18n();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const [form, setForm, clearForm] = useFormDraft(`fa06c:${visit.id}`, () => ({
    outcome: (PICKED_OUTCOMES as readonly string[]).includes(initial ?? '') ? (initial as PickedOutcome) : (null as PickedOutcome | null),
    revisitOn: null as string | null,
    revisitTime: '' as string,
    reason: null as string | null,
    note: '',
  }));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<'sent' | 'queued' | null>(null);
  const [busy, setBusy] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const { outcome, revisitOn, reason, note } = form;
  const revisitTime = form.revisitTime ?? '';
  const needsDate = outcome === 'interested_later' || outcome === 'owner_not_there';

  async function save() {
    if (!outcome) return setProblem(t('fa06c.pickOutcome'));
    if (needsDate && !revisitOn) return setProblem(t('fa06c.pickDate'));
    if (outcome === 'not_interested' && !reason) return setProblem(t('fa06c.pickReason'));
    setProblem(null);
    setBusy(true);
    try {
      const result = await queue.submit(`${t('fa06c.queueLabel')} · ${visit.name}`, {
        method: 'POST',
        path: visitPaths.outcome(visit.id),
        json: {
          outcome,
          ...(visit.hasBusiness || !visit.shopName ? {} : { shopName: visit.shopName }),
          ...(visit.spokeTo ? { spokeTo: visit.spokeTo } : {}),
          ...(visit.contactPhone ? { contactPhone: visit.contactPhone } : {}),
          ...(needsDate ? { revisitOn } : {}),
          ...(needsDate && revisitTime ? { revisitTime } : {}),
          ...(outcome === 'not_interested' ? { reason } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(visit.endedAt ? { endedAt: visit.endedAt } : {}),
        },
      });
      clearForm();
      setSaved(result.status);
      void client.invalidateQueries({ queryKey: ['field-work'] });
      void client.invalidateQueries({ queryKey: ['field-visits'] });
    } catch (e) {
      // Someone (or another phone) already gave this visit a result: show it instead.
      if (errorCode(e) === 'VISIT_RESULT_ALREADY_SET') {
        void client.invalidateQueries({ queryKey: queryKeys.visit(visit.id) });
        router.replace(pageRoutes.visitDetails(visit.id));
        return;
      }
      setProblem(isApiError(e) ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.flex} testID="screen-FA06c">
      <AppHeader title={t('fa06c.title')} />
      <Screen>
        <Card stripe accent="royal">
          <View style={styles.qRow}>
            <View style={styles.flex1}>
              <Text variant="h2">{t('fa06c.question')}</Text>
              <Text variant="muted">{visit.name}</Text>
            </View>
            <Emoji symbol="🤝" size={28} />
          </View>
          <View style={styles.gap} />
          <ChoiceList
            choices={PICKED_OUTCOMES.map((o) => ({ value: o, label: t(`fa06c.${o}` as const), ...OUTCOME_LOOK[o] }))}
            value={outcome}
            onChange={(o) => set({ outcome: o })}
            testID="fa06c-outcome"
          />
        </Card>
        {needsDate ? (
          <Card stripe accent="cyan">
            <DatePicker label={t('fa06c.comeBackOn')} value={revisitOn} onChange={(d) => set({ revisitOn: d })} now={openedAt} testID="fa06c-date" />
            {/* 21 Nov: an optional come-back time (the owner said "come at 4"). */}
            <TimeField label={t('fa06c.revisitTime')} value={revisitTime} onChange={(v) => set({ revisitTime: v })} from="07:00" to="21:00" step={30} testID="fa06c-time" />
          </Card>
        ) : null}
        {outcome === 'not_interested' ? (
          <Card stripe accent="orange">
            <Text variant="small" style={styles.label}>
              {t('fa06c.why')}
            </Text>
            <ChoiceList choices={REASONS.map((r) => ({ value: r, label: t(`reason.${r}` as const) }))} value={reason} onChange={(r) => set({ reason: r })} testID="fa06c-reason" />
          </Card>
        ) : null}
        <Card stripe accent="navy">
          <TextField label={t('fa06c.note')} value={note} onChangeText={(n) => set({ note: n })} multiline numberOfLines={3} maxLength={1000} testID="fa06c-note" />
        </Card>
        {problem ? <Banner tone="error" message={problem} testID="fa06c-problem" /> : null}
        {saved ? (
          <Banner tone={saved === 'sent' ? 'ok' : 'info'} message={saved === 'sent' ? t('fa06c.saved') : t('fa06c.queued')} testID="fa06c-saved" />
        ) : null}
        {saved ? (
          // Closes every step of this visit, so back never reopens them.
          <Button label={t('fa06c.backToVisits')} onPress={() => finishLater(routes.visits)} testID="fa06c-done" />
        ) : (
          <Button label={t('common.save')} loading={busy} onPress={() => void save()} testID="fa06c-save" />
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  gap: { height: 10 },
  flex1: { flex: 1 },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontWeight: '700', marginBottom: 8 },
});
