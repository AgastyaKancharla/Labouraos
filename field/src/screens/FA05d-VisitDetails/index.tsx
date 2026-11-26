import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, IconTile, ListRow, LoadingState, Screen, StatusChip, Text, TextField } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import { errorCode, visitPaths, type ResultSnapshot, type VisitDetails } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { useFormDraft } from '@/lib/formDraft';
import { routes } from '@/navigation/routes';
import { colors, radius } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { BusinessProfile } from '../_business/BusinessProfile';
import { ChoiceList } from '../_visits/ChoiceList';
import { DatePicker } from '../_visits/DatePicker';
import { formatDateKey, minutesOf } from '../_visits/format';
import { outcomeKey } from '../_visits/labels';
import { OUTCOME_LOOK, PICKED_OUTCOMES, REASONS, type PickedOutcome } from '../FA06c-VisitOutcome';

/** "Change result" needs a reason this long (server rule, CHANGE_REASON_REQUIRED). */
export const CHANGE_REASON_MIN = 10;

const NEXT_KEYS: Record<string, MessageKey> = {
  record_result: 'fa05d.next.record_result',
  take_selfie: 'fa05d.next.take_selfie',
  continue_business_form: 'fa05d.next.continue_business_form',
  mark_onboarded: 'fa05d.next.mark_onboarded',
  verify: 'fa05d.next.verify',
};

const CHANGE_ERRORS: Record<string, MessageKey> = {
  CHANGE_REASON_REQUIRED: 'fa05d.err.reason',
  REVISIT_DATE_REQUIRED: 'fa06c.pickDate',
  REVISIT_DATE_PAST: 'fa05d.err.datePast',
  NOT_INTERESTED_REASON_REQUIRED: 'fa06c.pickReason',
  RESULT_UNCHANGED: 'fa05d.err.unchanged',
  VISIT_ONBOARDED_LOCKED: 'fa05d.err.locked',
  VISIT_HAS_NO_RESULT: 'fa05d.err.noResult',
};

/**
 * FA05d — Visit details (redesign, 16 Nov): board photo, selfie, time at the
 * shop, result, note, come-back date and the history of changes, with
 * "Change result" (needs a reason, kept in history; never once Onboarded).
 * An unfinished visit offers its next step. Own visits only.
 * 27 Nov (owner): a visit of a registered business opens the same business
 * profile as the Businesses tab, with this visit as its first tab ("This visit").
 * A shop that is not registered keeps the visit page alone.
 * Data: GET /field-visits/:id, POST /field-visits/:id/change-result,
 * GET /field-work/businesses/:id/page.
 */
export default function VisitDetailsScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { redesign } = useEndpoints();
  const q = useQuery({ queryKey: queryKeys.visit(id ?? ''), queryFn: () => redesign.visit(id!), enabled: Boolean(id), staleTime: 0 });
  const businessId = q.data?.business?.id ?? null;
  const page = useQuery({ queryKey: queryKeys.businessPage(businessId ?? ''), queryFn: () => redesign.businessPage(businessId!), enabled: Boolean(businessId) });
  const refresh = () => {
    void q.refetch();
    if (businessId) void page.refetch();
  };
  return (
    <View style={styles.flex} testID="screen-FA05d">
      <AppHeader
        title={businessId ? t('fa08.title') : t('fa05d.title')}
        subtitle={q.data ? (businessId ? (page.data?.code ?? q.data.business?.code ?? undefined) : (q.data.shopName ?? undefined)) : undefined}
      />
      <Screen onRefresh={refresh} refreshing={q.isRefetching || page.isRefetching}>
        {!id ? (
          <EmptyState message={t('common.error')} />
        ) : q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : businessId && page.data ? (
          <BusinessProfile b={page.data} visitCard={<Details visit={q.data} compact />} />
        ) : businessId && page.isPending ? (
          <LoadingState />
        ) : (
          // No business yet, or its page could not load: the visit on its own.
          <Details visit={q.data} />
        )}
      </Screen>
    </View>
  );
}

function Details({ visit: v, compact }: { visit: VisitDetails; compact?: boolean }) {
  const { t } = useI18n();
  const [changing, setChanging] = useState(false);
  const minutes = minutesOf(v.durationSeconds);
  const name = v.business?.name ?? v.shopName ?? t('fa05.unnamedShop');
  const result = v.outcome ? t(outcomeKey(v.outcome)) : t('fa05d.noResult');
  const step = v.nextStep && v.nextStep !== 'done' ? v.nextStep : null;
  return (
    <>
      <Card testID="fa05d-summary">
        {compact ? (
          <Text variant="bodyStrong">{[t('history.visit'), formatDayIst(v.startedAt), formatTimeIst(v.startedAt)].join(' · ')}</Text>
        ) : (
          <>
            <Text variant="h2">{name}</Text>
            <Text variant="muted">{[v.business?.code, formatDayIst(v.startedAt), formatTimeIst(v.startedAt)].filter(Boolean).join(' · ')}</Text>
          </>
        )}
        <View style={styles.gap} />
        <ListRow
          title={t('fa05d.result')}
          leading={<IconTile icon={v.outcome === 'onboarded' ? 'check-circle' : v.outcome ? 'store' : 'clipboard'} accent={v.outcome === 'onboarded' ? 'green' : v.outcome ? 'cyan' : 'gold'} size={34} />}
          trailing={<StatusChip tone={v.outcome === 'onboarded' ? 'green' : v.outcome === 'already_onboarded' ? 'blue' : v.outcome ? 'cyan' : 'amber'} label={result} />}
          testID="fa05d-result"
        />
        <ListRow
          title={t('fa22.timeAtShop')}
          leading={<IconTile icon="clock" accent="gold" size={34} />}
          trailing={<Text variant="bodyStrong">{minutes !== null ? t('common.minutes', { minutes }) : t('common.placeholderValue')}</Text>}
          testID="fa05d-time"
        />
        {v.revisitOn ? (
          <ListRow title={t('fa05d.comeBack')} leading={<IconTile icon="calendar" accent="cyan" size={34} />} trailing={<Text variant="bodyStrong">{formatDateKey(v.revisitOn)}</Text>} testID="fa05d-revisit" />
        ) : null}
        {v.outcomeReason ? (
          <ListRow title={t('fa06c.why')} leading={<IconTile icon="x-circle" accent="orange" size={34} />} subtitle={t(`reason.${v.outcomeReason}` as MessageKey)} />
        ) : null}
        <ContactRow visit={v} />
        <ListRow title={t('fa05d.note')} leading={<IconTile icon="chat" accent="navy" size={34} />} subtitle={v.note || t('fa05d.noNote')} last testID="fa05d-note" />
      </Card>

      <Card title={t('fa05d.photos')} icon="camera" accent="royal">
        <View style={styles.photos}>
          <Photo label={t('fa05d.boardPhoto')} photo={v.boardPhoto ?? null} has={v.hasBoardPhoto} square={compact} testID="fa05d-board" />
          <Photo
            label={v.selfie?.distanceMeters != null ? t('fa05d.selfieAt', { meters: Math.round(v.selfie.distanceMeters) }) : t('fa05d.selfie')}
            photo={v.selfie ?? null}
            has={v.hasSelfie}
            square={compact}
            testID="fa05d-selfie"
          />
        </View>
      </Card>

      {step ? <NextStep visit={v} step={step} /> : null}

      {(v.resultHistory ?? []).length > 0 ? (
        <Card title={t('fa05d.history')} icon="clock" accent="gold" testID="fa05d-history">
          {(v.resultHistory ?? []).map((h, i, all) => (
            <ListRow
              key={`${h.at}-${i}`}
              title={`${snapshotText(h.from, t)} → ${snapshotText(h.to, t)}`}
              subtitle={`${formatDayIst(h.at)} ${formatTimeIst(h.at)} · ${h.byMe ? t('fa05d.byMe') : (h.byName ?? '—')}\n“${h.reason}”`}
              leading={<IconTile icon="flag" accent="navy" size={30} />}
              last={i === all.length - 1}
            />
          ))}
        </Card>
      ) : null}

      {v.canChangeResult && v.outcome !== 'onboarded' && v.outcome !== 'already_onboarded' ? (
        changing ? (
          <ChangeResult visit={v} onDone={() => setChanging(false)} />
        ) : (
          <Button label={t('fa05d.change')} variant="secondary" onPress={() => setChanging(true)} testID="fa05d-change" />
        )
      ) : v.outcome === 'onboarded' || v.outcome === 'already_onboarded' ? (
        <Text variant="muted" testID="fa05d-locked">{t('fa05d.lockedNote')}</Text>
      ) : null}
    </>
  );
}

/** Whom the agent spoke to (or the registered contact) and the mobile — last 4 digits only (AGENTS.md §7). */
export function contactMobile(v: Pick<VisitDetails, 'spokeTo' | 'contactPhone' | 'registeredContact'>): { name: string | null; mobile: string | null } {
  const last4 = (v.contactPhone ?? '').replace(/\D/g, '').slice(-4) || v.registeredContact?.phoneLast4 || '';
  return { name: v.spokeTo ?? v.registeredContact?.name ?? null, mobile: last4 ? `******${last4}` : null };
}

function ContactRow({ visit }: { visit: VisitDetails }) {
  const { t } = useI18n();
  const c = contactMobile(visit);
  return (
    <ListRow
      title={t('fa05d.contact')}
      leading={<IconTile icon="phone" accent="green" size={34} />}
      subtitle={c.mobile ? [c.name, c.mobile].filter(Boolean).join(' · ') : t('fa05d.noContact')}
      testID="fa05d-contact"
    />
  );
}

function snapshotText(s: ResultSnapshot, t: (key: MessageKey) => string): string {
  return [t(outcomeKey(s.outcome)), s.revisitOn ? formatDateKey(s.revisitOn) : null].filter(Boolean).join(' · ');
}

function Photo({ label, photo, has, square, testID }: { label: string; photo: { url: string; takenAt: string } | null; has: boolean; square?: boolean; testID: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.photo} testID={testID}>
      {photo ? (
        <Image source={{ uri: photo.url }} style={[styles.image, square && styles.square]} accessibilityLabel={label} resizeMode="cover" />
      ) : (
        <View style={[styles.image, square && styles.square, styles.noImage]}>
          <Text variant="small" align="center">{has ? t('fa05d.photoGone') : t('fa05d.noPhoto')}</Text>
        </View>
      )}
      <Text variant="small">{label}</Text>
      {photo ? <Text variant="tiny">{`${formatDayIst(photo.takenAt)} ${formatTimeIst(photo.takenAt)}`}</Text> : null}
    </View>
  );
}

/** The step a visit still needs, opened in the Visits tab where visits live. */
function NextStep({ visit: v, step }: { visit: VisitDetails; step: string }) {
  const { t } = useI18n();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  // Rev 189: a business counts as Onboarded only once. A revisit of one onboarded before is saved as "Already onboarded".
  const already = Boolean(v.businessAlreadyOnboarded);
  const markOnboarded = useMutation({
    mutationFn: () =>
      queue.submit<{ outcome?: string }>(`${t('fa06c.queueLabel')} · ${v.business?.name ?? ''}`, {
        method: 'POST',
        path: visitPaths.outcome(v.id),
        json: { outcome: already ? 'already_onboarded' : 'onboarded' },
      }),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['field-work'] });
      void client.invalidateQueries({ queryKey: queryKeys.visit(v.id) });
      const recorded = result.status === 'sent' ? result.response?.outcome : undefined;
      // A first onboarding goes on to the agreement; an already onboarded business just keeps the saved visit.
      if (!already && recorded !== 'already_onboarded' && v.business) router.push({ pathname: routes.visitAgreement, params: { businessId: v.business.id, visitId: v.id } });
    },
  });
  function go() {
    switch (step) {
      case 'record_result':
        return router.push({ pathname: routes.visitTalk, params: { id: v.id } });
      case 'take_selfie':
        return router.push({ pathname: routes.visitProof, params: { id: v.id } });
      case 'continue_business_form':
        return router.push({ pathname: routes.visitBusiness, params: { visitId: v.id } });
      case 'mark_onboarded':
        return markOnboarded.mutate();
      case 'verify':
        return v.business && v.assignmentId
          ? router.push({ pathname: routes.visitVerify, params: { businessId: v.business.id, assignmentId: v.assignmentId } })
          : undefined;
    }
  }
  return (
    <Card stripe accent="gold" testID="fa05d-next">
      <Text variant="bodyStrong">{t('fa05d.unfinished')}</Text>
      <View style={styles.gap} />
      <Button
        label={step === 'mark_onboarded' && already ? t('fa05d.next.already_onboarded') : t(NEXT_KEYS[step] ?? 'fa05d.next.record_result')}
        loading={markOnboarded.isPending}
        onPress={go}
        testID={`fa05d-next-${step}`}
      />
      {step === 'mark_onboarded' && already ? <Text variant="muted" testID="fa05d-already-note">{t('fa05d.alreadyNote')}</Text> : null}
      {markOnboarded.error ? <Banner tone="error" message={isApiError(markOnboarded.error) ? markOnboarded.error.message : t('common.error')} /> : null}
    </Card>
  );
}

function ChangeResult({ visit: v, onDone }: { visit: VisitDetails; onDone: () => void }) {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const client = useQueryClient();
  const [openedAt] = useState(() => Date.now());
  const [form, setForm, clearForm] = useFormDraft(`fa05d-change:${v.id}`, () => ({
    outcome: null as PickedOutcome | null,
    revisitOn: null as string | null,
    outcomeReason: null as string | null,
    reason: '',
    note: '',
  }));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const [problem, setProblem] = useState<string | null>(null);
  const needsDate = form.outcome === 'interested_later' || form.outcome === 'owner_not_there';
  const save = useMutation({
    mutationFn: () =>
      redesign.changeResult(v.id, {
        outcome: form.outcome!,
        reason: form.reason.trim(),
        ...(needsDate && form.revisitOn ? { revisitOn: form.revisitOn } : {}),
        ...(form.outcome === 'not_interested' && form.outcomeReason ? { outcomeReason: form.outcomeReason } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      }),
    onSuccess: (updated) => {
      clearForm();
      client.setQueryData(queryKeys.visit(v.id), updated);
      void client.invalidateQueries({ queryKey: ['field-work'] });
      onDone();
    },
    onError: (e) => {
      const code = errorCode(e);
      setProblem(code && CHANGE_ERRORS[code] ? t(CHANGE_ERRORS[code]) : isApiError(e) ? e.message : t('common.error'));
    },
  });
  function submit() {
    if (!form.outcome) return setProblem(t('fa06c.pickOutcome'));
    if (needsDate && !form.revisitOn) return setProblem(t('fa06c.pickDate'));
    if (form.outcome === 'not_interested' && !form.outcomeReason) return setProblem(t('fa06c.pickReason'));
    if (form.reason.trim().length < CHANGE_REASON_MIN) return setProblem(t('fa05d.err.reason'));
    setProblem(null);
    save.mutate();
  }
  return (
    <Card title={t('fa05d.change')} icon="flag" accent="orange" stripe testID="fa05d-change-form">
      <ChoiceList
        choices={PICKED_OUTCOMES.map((o) => ({ value: o, label: t(`fa06c.${o}` as const), ...OUTCOME_LOOK[o] }))}
        value={form.outcome}
        onChange={(o) => set({ outcome: o })}
        testID="fa05d-outcome"
      />
      {needsDate ? <DatePicker label={t('fa06c.comeBackOn')} value={form.revisitOn} onChange={(d) => set({ revisitOn: d })} now={openedAt} testID="fa05d-date" /> : null}
      {form.outcome === 'not_interested' ? (
        <ChoiceList choices={REASONS.map((r) => ({ value: r, label: t(`reason.${r}` as const) }))} value={form.outcomeReason} onChange={(r) => set({ outcomeReason: r })} testID="fa05d-why" />
      ) : null}
      <View style={styles.gap} />
      <TextField
        label={t('fa05d.reason')}
        hint={t('fa05d.reasonHint', { count: CHANGE_REASON_MIN })}
        value={form.reason}
        onChangeText={(r) => set({ reason: r })}
        multiline
        maxLength={500}
        testID="fa05d-reason"
      />
      <TextField label={t('fa06c.note')} value={form.note} onChangeText={(n) => set({ note: n })} multiline maxLength={1000} testID="fa05d-change-note" />
      {problem ? <Banner tone="error" message={problem} testID="fa05d-change-problem" /> : null}
      <View style={styles.row}>
        <Button label={t('common.cancel')} variant="secondary" style={styles.flex1} onPress={onDone} />
        <Button label={t('common.save')} style={styles.flex1} loading={save.isPending} onPress={submit} testID="fa05d-change-save" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  gap: { height: 10 },
  row: { flexDirection: 'row', gap: 8, marginTop: 10 },
  photos: { flexDirection: 'row', gap: 10 },
  photo: { flex: 1, gap: 4 },
  image: { width: '100%', aspectRatio: 3 / 4, borderRadius: radius.md, backgroundColor: colors.neutral100 },
  square: { aspectRatio: 1 },
  noImage: { alignItems: 'center', justifyContent: 'center', padding: 8 },
});
