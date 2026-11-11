import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { BusinessHit } from '@/api/endpoints';
import { Card, ErrorState, LoadingState, Screen, Text } from '@/components';
import { useI18n } from '@/i18n';
import { routes, sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { BusinessRow, BusinessTypeAhead, Empty } from '../_selling';

/**
 * FA19 — Vacancies tab. Pick the business by typing its name (type-ahead),
 * then the quick vacancy form (FA17). "Recent": the agent's businesses with
 * vacancies and how many still wait for the owner's OTP — tap one waiting
 * to confirm it (FA17b).
 */
export default function VacanciesScreen() {
  const { t, tn } = useI18n();
  const { selling } = useEndpoints();
  const recent = useQuery({ queryKey: queryKeys.sellingRecent, queryFn: () => selling.recentVacancies() });
  const openRecent = (b: BusinessHit) => {
    const waiting = b.vacancies.find((v) => v.status === 'awaiting_confirmation');
    router.push(waiting ? sellingRoutes.confirmVacancy(waiting.id) : sellingRoutes.addVacancy(b.id));
  };
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('tabs.vacancies')} />
      <Screen testID="screen-FA19" onRefresh={() => void recent.refetch()} refreshing={recent.isRefetching}>
        <Text variant="h2" style={styles.title}>{t('fa17.title')}</Text>
        <BusinessTypeAhead onPick={(b) => router.push(sellingRoutes.addVacancy(b.id))} onRegister={() => router.push(routes.visitStart)} hintKey="fa19.hint" />
        <Card title={t('fa19.recent')}>
          {recent.isPending ? (
            <LoadingState compact />
          ) : recent.isError ? (
            <ErrorState compact error={recent.error} onRetry={() => void recent.refetch()} />
          ) : recent.data.results.length === 0 ? (
            <Empty message={t('fa19.noRecent')} />
          ) : (
            recent.data.results.map((b, i) => (
              <BusinessRow
                key={b.id}
                business={b}
                last={i === recent.data.results.length - 1}
                onPress={() => openRecent(b)}
                subtitle={b.vacancies
                  .map((v) => `${v.headcount > 1 ? `${v.trade} × ${v.headcount}` : v.trade} ${v.status === 'open' ? t('fa19.otpConfirmed') : t('fa19.waitingOtp')}`)
                  .join(' · ')}
                chip={b.waitingForOtp > 0 ? { label: tn('fa19.waiting', b.waitingForOtp), tone: 'amber' } : undefined}
              />
            ))
          )}
        </Card>
        <Text variant="muted">{t('fa19.note')}</Text>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 17 },
});
