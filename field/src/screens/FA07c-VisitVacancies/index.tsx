import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { routes } from '@/navigation/routes';
import { useSellingRoutes } from '@/navigation/useFlow';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { FinishLaterButton } from '../_visits/FinishLater';
import { StepHeader } from '../_visits/StepHeader';
import { VacancyStep } from '../_business/VacancyStep';

/**
 * FA07c — vacancies, step 6 of 7 (redesign, 16 Nov). The staff-needed rows of
 * the business form are drafts: the agent checks each one with one tap
 * ("Check and send to owner"), then the owner confirms it by code here in the
 * shop or later by the SMS link. A business can be onboarded with no vacancy;
 * it adds them later in the Laboura app or by calling the Laboura team.
 * Data: GET /field-work/businesses/:id/page.
 */
export default function VisitVacanciesScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ businessId?: string; visitId?: string }>();
  const { redesign } = useEndpoints();
  const sr = useSellingRoutes();
  const businessId = params.businessId ?? '';
  const q = useQuery({ queryKey: queryKeys.businessPage(businessId), queryFn: () => redesign.businessPage(businessId), enabled: Boolean(businessId) });
  return (
    <View style={styles.flex} testID="screen-FA07c">
      <AppHeader title={t('fa07c.title')} subtitle={q.data?.name} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        <StepHeader step={6} />
        {!businessId ? (
          <EmptyState message={t('common.error')} />
        ) : q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <Card title={t('fa07c.vacancies')} icon="briefcase" accent="navy" testID="fa07c-list">
              {q.data.vacancies.length === 0 ? <EmptyState compact emoji="🧑‍🍳" message={t('fa07c.none')} /> : null}
              {q.data.vacancies.map((v, i) => (
                <VacancyStep key={v.id} vacancy={v} businessId={businessId} sr={sr} canAct={q.data.canAct} last={i === q.data.vacancies.length - 1} />
              ))}
            </Card>
            <Text variant="muted">{t('fa07c.later')}</Text>
            <Button
              label={t('fa07c.next')}
              onPress={() => router.push({ pathname: routes.visitDone, params: { businessId, ...(params.visitId ? { visitId: params.visitId } : {}) } })}
              testID="fa07c-next"
            />
            <FinishLaterButton />
          </>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
