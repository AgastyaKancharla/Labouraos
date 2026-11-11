import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, ListRow, LoadingState, Screen, StatusChip, Text } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';

/**
 * FA06b — Visit complete. After an in-person onboarding or a verification
 * visit: proof done, the agreement (signed by the contact person on his own
 * phone, or still waiting), the vacancies, and the Team Lead's review later
 * today. "Show candidates now" opens only when candidates may be shown
 * (signed, onboarded in person, not paused). Polls until the agreement is signed.
 */
export default function VisitDoneScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ businessId?: string; visitId?: string }>();
  const { fieldWork } = useEndpoints();
  const q = useQuery({
    queryKey: queryKeys.fieldBusiness(params.businessId ?? ''),
    queryFn: () => fieldWork.business(params.businessId!),
    enabled: Boolean(params.businessId),
    refetchInterval: (query) => (query.state.data?.agreement ? false : 10_000),
  });
  if (!params.businessId) return <EmptyState message={t('common.error')} />;
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  const vacancies = b.vacancies.map((v) => `${v.trade} × ${v.headcount}`).join(' · ');

  return (
    <View style={styles.flex} testID="screen-FA06b">
      <AppHeader title={t('fa03.headerTitle')} />
      <Screen>
        <Banner
          tone={b.agreement ? 'ok' : 'warn'}
          title={b.agreement?.signedName ? t('fa06b.signedBy', { name: b.agreement.signedName }) : t('fa06b.waitingTitle')}
          testID="fa06b-banner"
        />
        <Text variant="h1">{b.name}</Text>
        <Card>
          <ListRow title={t('fa06b.proof')} trailing={<StatusChip tone="green" label={t('fa06.done')} />} />
          <ListRow
            title={t('fa06b.agreement')}
            trailing={
              b.agreement ? (
                <StatusChip tone="green" label={t('fa06b.signedAt', { time: formatTimeIst(b.agreement.signedAt) })} />
              ) : (
                <StatusChip tone="amber" label={t('fa06b.waiting')} />
              )
            }
            testID="fa06b-agreement"
          />
          <ListRow title={t('fa06b.vacancies')} subtitle={vacancies || t('fa06b.noVacancies')} />
          <ListRow
            title={t('fa06b.tlReview')}
            trailing={<StatusChip tone={b.verificationStatus === 'verified' ? 'green' : 'neutral'} label={b.verificationStatus === 'verified' ? t('vstatus.verified') : t('fa06b.laterToday')} />}
            last
          />
        </Card>
        {!b.canShowCandidates ? <Banner tone="info" message={t('fa06b.hiddenUntilSigned')} /> : null}
        <Button
          label={t('fa06b.showCandidates')}
          disabled={!b.canShowCandidates}
          onPress={() => router.push({ pathname: routes.jobSeekers, params: { businessId: b.id } })}
          testID="fa06b-show"
        />
        {params.visitId ? (
          <Button label={t('fa06b.recordOutcome')} variant="secondary" onPress={() => router.push({ pathname: routes.visitOutcome, params: { id: params.visitId } })} testID="fa06b-outcome" />
        ) : null}
        <Text variant="muted">{t('fa06b.accountAgent')}</Text>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
