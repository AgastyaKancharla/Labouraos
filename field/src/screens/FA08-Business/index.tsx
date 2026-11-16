import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, HeroCard, Icon, IconTile, ListRow, LoadingState, Screen, StatusChip, Text } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import { errorCode, type BusinessNextStep, type BusinessPage } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { pageRoutes, routes } from '@/navigation/routes';
import { useSellingRoutes } from '@/navigation/useFlow';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { istDateKey, minutesOf } from '../_visits/format';
import { outcomeKey, verificationKey } from '../_visits/labels';
import { VacancyStep } from '../_business/VacancyStep';

const HIDDEN_KEYS: Record<string, MessageKey> = {
  suspended: 'biz.hidden.suspended',
  paused: 'biz.hidden.paused',
  agreement_not_signed: 'biz.hidden.agreement_not_signed',
  visit_outside_area: 'biz.hidden.visit_outside_area',
  not_verified: 'biz.hidden.not_verified',
};

/** "What this business needs next", one line in the agent's language. */
export function nextStepText(step: BusinessNextStep, t: (key: MessageKey) => string): string {
  switch (step.kind) {
    case 'agreement_waiting':
      return t(step.agreementState === 'link_expired' ? 'biz.next.agreement_expired' : step.agreementState === 'not_sent' ? 'biz.next.agreement_not_sent' : 'biz.next.agreement_waiting');
    case 'candidates_hidden':
      return t(step.reason === 'visit_outside_area' ? 'biz.hidden.visit_outside_area' : 'biz.hidden.not_verified');
    default:
      return t(`biz.next.${step.kind}` as MessageKey);
  }
}

/**
 * FA08 — the one business page (redesign, 16 Nov; replaces the two business
 * screens): name, area, account agent, status; the onboarding checklist
 * (registered, owner's phone confirmed, agreement signed or Resend agreement
 * link, Team Lead check); vacancies, each with its one next step, and
 * + Vacancy; candidates shown and interviews; visit history; Record a visit
 * and Call owner. A business that is not the agent's own is view-only (the
 * server sends no contact and no actions, and refuses writes).
 * Data: GET /field-work/businesses/:id/page.
 */
export default function BusinessScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { redesign } = useEndpoints();
  const q = useQuery({ queryKey: queryKeys.businessPage(id ?? ''), queryFn: () => redesign.businessPage(id!), enabled: Boolean(id) });
  return (
    <View style={styles.flex} testID="screen-FA08">
      <AppHeader title={t('fa08.title')} subtitle={q.data?.code} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        {!id ? (
          <EmptyState message={t('common.error')} />
        ) : q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <Page b={q.data} />
        )}
      </Screen>
    </View>
  );
}

function Page({ b }: { b: BusinessPage }) {
  const { t } = useI18n();
  const sr = useSellingRoutes();
  const [today] = useState(() => istDateKey(Date.now()));
  const verified = b.status.verificationStatus === 'verified' && !b.status.paused && !b.status.suspended;
  return (
    <>
      <HeroCard
        title={b.name}
        subtitle={[b.businessType ? t(`btype.${b.businessType}` as 'btype.other') : null, b.locality, b.code].filter(Boolean).join(' · ')}
        emoji="🏪"
        corner={<StatusChip tone={verified ? 'green' : 'amber'} label={b.status.suspended ? t('biz.suspended') : t(verificationKey(b.status.verificationStatus, b.status.paused))} />}
        testID="fa08-hero"
      />
      <ListRow
        title={b.accountAgent ? (b.accountAgent.isMe ? t('biz.yourBusiness') : t('biz.accountAgent', { name: b.accountAgent.name })) : t('biz.noAccountAgent')}
        leading={<IconTile icon="user" accent="navy" size={34} />}
        subtitle={b.canAct ? nextStepText(b.nextStep, t) : undefined}
        testID="fa08-agent"
        last
      />
      {!b.canAct ? <Banner tone="info" title={t('biz.viewOnly')} message={t('biz.viewOnlyBody')} testID="fa08-view-only" /> : null}

      {b.canAct ? (
        <View style={styles.actions}>
          <Button
            label={t('fa08.recordVisit')}
            icon={<Icon name="camera" color={colors.white} />}
            style={styles.cell}
            disabled={!b.actions.recordVisit}
            onPress={() => router.push({ pathname: routes.visitStart, params: { businessId: b.id, name: b.name } })}
            testID="fa08-visit"
          />
          <Button
            label={t('fa08.callOwner')}
            icon={<Icon name="phone" color={colors.greenText} />}
            variant="secondary"
            style={styles.cell}
            disabled={!b.actions.callOwner}
            onPress={() => router.push(sr.callOwner(b.id))}
            testID="fa08-call"
          />
        </View>
      ) : null}

      <Checklist b={b} />

      <Card title={t('biz.vacancies')} icon="briefcase" accent="orange" testID="fa08-vacancies">
        {b.vacancies.length === 0 ? <EmptyState compact emoji="🧑‍🍳" message={t('biz.noVacancies')} /> : null}
        {b.vacancies.map((v, i) => (
          <VacancyStep key={v.id} vacancy={v} businessId={b.id} sr={sr} canAct={b.canAct} last={i === b.vacancies.length - 1} />
        ))}
        {b.actions.addVacancy ? (
          <Button label={t('fa03.addVacancy')} variant="secondary" onPress={() => router.push(sr.addVacancy(b.id))} testID="fa08-vacancy" />
        ) : null}
      </Card>

      <Card title={t('biz.candidates')} icon="users" accent="cyan" testID="fa08-candidates">
        {!b.status.canShowCandidates && b.status.candidatesHiddenReason ? (
          <Banner tone="info" plain message={t(HIDDEN_KEYS[b.status.candidatesHiddenReason] ?? 'biz.hidden.not_verified')} testID="fa08-hidden" />
        ) : null}
        <ListRow
          title={t('fa08.shown')}
          leading={<IconTile icon="users" accent="cyan" size={34} />}
          trailing={<Text variant="bodyStrong">{b.candidates.shownByMe !== b.candidates.shown ? `${b.candidates.shown} · ${t('biz.byYou', { count: b.candidates.shownByMe })}` : String(b.candidates.shown)}</Text>}
        />
        <ListRow
          title={t('fa08.interviews')}
          leading={<IconTile icon="calendar" accent="gold" size={34} />}
          trailing={<Text variant="bodyStrong">{t('biz.interviewCounts', { total: b.candidates.interviews.total, today: b.candidates.interviews.today, upcoming: b.candidates.interviews.upcoming })}</Text>}
        />
        <ListRow
          title={t('fa08.placements')}
          leading={<IconTile icon="trophy" accent="green" size={34} />}
          trailing={<Text variant="bodyStrong">{b.candidates.inGuarantee > 0 ? `${b.candidates.placements} · ${t('fa08.inGuarantee', { count: b.candidates.inGuarantee })}` : String(b.candidates.placements)}</Text>}
          last={b.candidates.recentInterviews.length === 0}
        />
        {b.candidates.recentInterviews.map((iv, i, all) => {
          const isToday = istDateKey(iv.startsAt) === today;
          return (
            <ListRow
              key={iv.id}
              title={`${iv.candidateName} · ${isToday ? `${t('date.today')} ${formatTimeIst(iv.startsAt)}` : formatDayIst(iv.startsAt)}`}
              subtitle={iv.code}
              leading={<IconTile icon="calendar" accent={isToday ? 'royal' : 'navy'} size={30} />}
              trailing={<StatusChip tone={iv.result === 'selected' ? 'green' : iv.result ? 'neutral' : 'blue'} label={iv.result ? t(`result.${iv.result}` as MessageKey) : t('biz.interviewOpen')} />}
              onPress={b.canAct ? () => router.push(isToday ? sr.interviewDay(iv.id) : sr.booked(iv.id)) : undefined}
              last={i === all.length - 1}
              testID={`fa08-interview-${iv.id}`}
            />
          );
        })}
        {b.actions.showCandidates ? (
          <Button label={t('fa08.showCandidates')} icon={<Icon name="users" color={colors.white} />} onPress={() => router.push(sr.matches(b.id))} testID="fa08-show" />
        ) : null}
      </Card>

      <Card title={t('fa08.visitHistory')} icon="clock" accent="gold" testID="fa08-visits">
        {b.visits.length === 0 ? <EmptyState compact emoji="👟" message={t('fa08.noVisits')} /> : null}
        {b.visits.map((v, i) => {
          const m = minutesOf(v.durationSeconds);
          const when = istDateKey(v.at) === today ? `${t('date.today')} ${formatTimeIst(v.at)}` : formatDayIst(v.at);
          const proof = [v.hasBoardPhoto ? '📷' : null, v.hasSelfie ? t('fa05.plusSelfie') : null].filter(Boolean).join(' ');
          return (
            <ListRow
              key={v.id}
              title={[when, m !== null ? t('common.minutes', { minutes: m }) : null, proof || null].filter(Boolean).join(' · ')}
              subtitle={v.staffName ?? undefined}
              leading={<IconTile icon={v.outcome === 'onboarded' ? 'check-circle' : v.outcome ? 'store' : 'clipboard'} accent={v.outcome === 'onboarded' ? 'green' : v.outcome ? 'cyan' : 'gold'} size={34} />}
              trailing={<StatusChip tone={v.outcome === 'onboarded' ? 'green' : v.outcome ? 'cyan' : 'amber'} label={t(outcomeKey(v.outcome))} />}
              // Visit details are for the agent's own visits.
              onPress={v.mine ? () => router.push(pageRoutes.visitDetails(v.id, '/businesses')) : undefined}
              last={i === b.visits.length - 1}
              testID={`fa08-visit-${v.id}`}
            />
          );
        })}
      </Card>
    </>
  );
}

/** Registered · owner's phone confirmed · agreement signed (or Resend link) · Team Lead check. */
function Checklist({ b }: { b: BusinessPage }) {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const a = b.checklist.agreement;
  const resend = useMutation({
    mutationFn: () => queue.live(() => redesign.resendAgreement(b.id, b.contact?.language === 'en' ? 'en' : b.contact?.language === 'kn' ? 'kn' : undefined)),
    onSettled: () => void client.invalidateQueries({ queryKey: ['field-work'] }),
  });
  const tl = b.checklist.teamLeadCheck.state;
  const agreementChip =
    a.state === 'signed'
      ? { tone: 'green' as const, label: a.signedAt ? t('fa06b.signedAt', { time: formatDayIst(a.signedAt) }) : t('fa07b.signed') }
      : { tone: a.state === 'link_sent' ? ('amber' as const) : ('tomato' as const), label: t(`fa07b.state.${a.state}` as MessageKey) };
  const resendCode = resend.error ? errorCode(resend.error) : null;
  return (
    <Card title={t('biz.checklist')} icon="clipboard" accent="royal" testID="fa08-checklist">
      <ListRow title={t('biz.check.registered')} leading={<IconTile icon="check" accent="green" size={30} />} trailing={<StatusChip tone="green" label={b.checklist.registered.at ? formatDayIst(b.checklist.registered.at) : t('fa06.done')} />} />
      <ListRow
        title={t('biz.check.phone')}
        leading={<IconTile icon={b.checklist.ownerPhoneVerified.done ? 'check' : 'clock'} accent={b.checklist.ownerPhoneVerified.done ? 'green' : 'gold'} size={30} />}
        trailing={<StatusChip tone={b.checklist.ownerPhoneVerified.done ? 'green' : 'amber'} label={b.checklist.ownerPhoneVerified.done ? t('fa06.done') : t('biz.notYet')} />}
        testID="fa08-check-phone"
      />
      <ListRow
        title={t('biz.check.agreement')}
        subtitle={a.state !== 'signed' && a.linkSentAt ? t('fa07b.linkSent', { last4: a.sentToLast4 ?? '—', time: formatTimeIst(a.linkSentAt) }) : undefined}
        leading={<IconTile icon={a.state === 'signed' ? 'check' : 'document'} accent={a.state === 'signed' ? 'green' : 'orange'} size={30} />}
        trailing={<StatusChip tone={agreementChip.tone} label={agreementChip.label} />}
        testID="fa08-check-agreement"
      />
      {b.actions.resendAgreement ? (
        <>
          <Button
            label={resend.isSuccess ? t('fa07b.resent', { last4: resend.data.sentToLast4 }) : t('fa07b.resend')}
            variant="secondary"
            loading={resend.isPending}
            disabled={resend.isSuccess || a.canResend === false}
            onPress={() => resend.mutate()}
            testID="fa08-resend"
          />
          {resend.error ? (
            <Banner
              tone="error"
              message={resendCode === 'AGREEMENT_SMS_FAILED' ? t('fa07b.err.smsFailed') : resendCode?.startsWith('AGREEMENT_RESEND') ? t('fa07b.err.tooSoonNoTime') : isApiError(resend.error) ? resend.error.message : t('common.error')}
            />
          ) : null}
        </>
      ) : null}
      <ListRow
        title={t('biz.check.teamLead')}
        leading={<IconTile icon={tl === 'done' ? 'check' : 'shield'} accent={tl === 'done' ? 'green' : 'navy'} size={30} />}
        trailing={<StatusChip tone={tl === 'done' ? 'green' : tl === 'waiting' ? 'amber' : 'neutral'} label={t(`biz.tl.${tl}` as MessageKey)} />}
        last
        testID="fa08-check-tl"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexBasis: '48%', flexGrow: 1 },
});
