import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, Emoji, EmptyState, ErrorState, IconTile, ListRow, LoadingState, Screen, StatusChip, Text } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { finishLater, useSellingRoutes } from '@/navigation/useFlow';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { StepHeader } from '../_visits/StepHeader';
import { FinishLaterButton } from '../_visits/FinishLater';
import { vacancyLine } from '../_business/VacancyStep';

const HIDDEN_KEYS: Record<string, MessageKey> = {
  suspended: 'biz.hidden.suspended',
  paused: 'biz.hidden.paused',
  agreement_not_signed: 'biz.hidden.agreement_not_signed',
  visit_outside_area: 'biz.hidden.visit_outside_area',
  not_verified: 'biz.hidden.not_verified',
};

/**
 * FA06b — candidates, step 7 of 7 (redesign, 16 Nov), also the end of a
 * verification visit. What is done (proof, agreement, vacancies, the Team
 * Lead's check later today) and, once candidates may be shown (signed,
 * onboarded in person, not paused), "Show candidates" for each confirmed
 * vacancy, still inside the Visits tab. The visit is already Onboarded: no
 * "How did the visit go?" here. Asks again every 10 seconds until signed.
 * Data: GET /field-work/businesses/:id/page.
 */
export default function VisitDoneScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ businessId?: string; visitId?: string }>();
  const { redesign } = useEndpoints();
  const sr = useSellingRoutes();
  const businessId = params.businessId ?? '';
  const q = useQuery({
    queryKey: queryKeys.businessPage(businessId),
    queryFn: () => redesign.businessPage(businessId),
    enabled: Boolean(businessId),
    refetchInterval: (query) => (query.state.data?.checklist.agreement.state === 'signed' ? false : 10_000),
  });
  if (!businessId) return <EmptyState message={t('common.error')} />;
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  const signed = b.checklist.agreement.state === 'signed';
  const open = b.vacancies.filter((v) => v.status === 'open');
  const waiting = b.vacancies.filter((v) => v.status !== 'open');
  const verified = b.checklist.teamLeadCheck.state === 'done';

  return (
    <View style={styles.flex} testID="screen-FA06b">
      <AppHeader title={t('fa06b.title')} subtitle={b.name} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        <StepHeader step={7} />
        <Banner
          tone={signed ? 'ok' : 'warn'}
          title={signed && b.checklist.agreement.signedByName ? t('fa06b.signedBy', { name: b.checklist.agreement.signedByName }) : signed ? t('fa07b.signed') : t('fa06b.waitingTitle')}
          testID="fa06b-banner"
        />
        <View style={styles.titleRow}>
          <Text variant="h1" style={styles.flex1}>{b.name}</Text>
          <Emoji symbol={signed ? '🎉' : '🏪'} size={30} />
        </View>
        <Card>
          <ListRow title={t('fa06b.proof')} leading={<IconTile icon="camera" accent="cyan" size={34} />} trailing={<StatusChip tone="green" label={t('fa06.done')} />} />
          <ListRow
            title={t('fa06b.agreement')}
            leading={<IconTile icon="document" accent={signed ? 'green' : 'gold'} size={34} />}
            trailing={
              signed && b.checklist.agreement.signedAt ? (
                <StatusChip tone="green" label={t('fa06b.signedAt', { time: formatTimeIst(b.checklist.agreement.signedAt) })} />
              ) : (
                <StatusChip tone="amber" label={t('fa06b.waiting')} />
              )
            }
            onPress={signed ? undefined : () => router.push({ pathname: routes.visitAgreement, params: { businessId: b.id, ...(params.visitId ? { visitId: params.visitId } : {}) } })}
            testID="fa06b-agreement"
          />
          <ListRow
            title={t('fa06b.vacancies')}
            leading={<IconTile icon="briefcase" accent="orange" size={34} />}
            subtitle={b.vacancies.length ? b.vacancies.map((v) => vacancyLine(v, t)).join('\n') : t('fa06b.noVacancies')}
            onPress={waiting.length ? () => router.push({ pathname: routes.visitVacancies, params: { businessId: b.id, ...(params.visitId ? { visitId: params.visitId } : {}) } }) : undefined}
            testID="fa06b-vacancies"
          />
          <ListRow
            title={t('fa06b.tlReview')}
            leading={<IconTile icon="shield" accent={verified ? 'green' : 'navy'} size={34} />}
            trailing={<StatusChip tone={verified ? 'green' : 'neutral'} label={verified ? t('vstatus.verified') : t('fa06b.laterToday')} />}
            last
          />
        </Card>
        {!b.status.canShowCandidates ? (
          <Banner tone="info" message={t(HIDDEN_KEYS[b.status.candidatesHiddenReason ?? 'agreement_not_signed'] ?? 'fa06b.hiddenUntilSigned')} testID="fa06b-hidden" />
        ) : open.length === 0 ? (
          <Banner tone="info" message={t('fa06b.noOpenVacancy')} testID="fa06b-no-open" />
        ) : null}
        {open.map((v) => (
          <Button
            key={v.id}
            label={t('fa06b.showFor', { vacancy: vacancyLine(v, t) })}
            disabled={!b.status.canShowCandidates}
            onPress={() => router.push(sr.matches(b.id, v.id))}
            testID={`fa06b-show-${v.id}`}
          />
        ))}
        {open.length === 0 ? (
          <Button label={t('fa06b.showCandidates')} disabled testID="fa06b-show" />
        ) : null}
        {signed ? <Button label={t('fa06b.done')} variant="secondary" onPress={() => finishLater(routes.visits)} testID="fa06b-done" /> : <FinishLaterButton />}
        <Text variant="muted">{t('fa06b.accountAgent')}</Text>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
