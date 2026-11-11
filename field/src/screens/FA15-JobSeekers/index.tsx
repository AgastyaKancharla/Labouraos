import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { BusinessHit } from '@/api/endpoints';
import { Card, ErrorState, LoadingState, Screen } from '@/components';
import { useI18n } from '@/i18n';
import { routes, sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { BusinessRow, BusinessTypeAhead, Empty } from '../_selling';

/**
 * FA15 — Job seekers tab. Type two letters and matching registered businesses
 * appear as he types (GET /screens/field-selling/businesses?q=); no match →
 * Register this business (opens the shop visit). Below: the agent's own
 * businesses, newest first. A business whose agreement isn't signed yet shows
 * "Sign first" instead of candidates.
 */
export default function JobSeekersScreen() {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const mine = useQuery({ queryKey: queryKeys.sellingBusinesses(''), queryFn: () => selling.businesses('') });

  const open = (b: BusinessHit) => router.push(sellingRoutes.matches(b.id));

  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('tabs.jobSeekers')} />
      <Screen testID="screen-FA15" onRefresh={() => void mine.refetch()} refreshing={mine.isRefetching}>
        <BusinessTypeAhead onPick={open} onRegister={() => router.push(routes.visitStart)} hintKey="fa15.hint" />
        <Card title={t('fa15.yourBusinesses')}>
          {mine.isPending ? (
            <LoadingState compact />
          ) : mine.isError ? (
            <ErrorState compact error={mine.error} onRetry={() => void mine.refetch()} />
          ) : mine.data.results.length === 0 ? (
            <Empty message={t('fa15.noBusinesses')} />
          ) : (
            mine.data.results.map((b, i) => (
              <BusinessRow
                key={b.id}
                business={b}
                last={i === mine.data.results.length - 1}
                onPress={() => open(b)}
                subtitle={businessSubtitle(b, t)}
                chip={!b.agreementSigned ? { label: t('fa15.signFirst'), tone: 'amber' } : undefined}
              />
            ))
          )}
        </Card>
      </Screen>
    </View>
  );
}

function businessSubtitle(b: BusinessHit, t: ReturnType<typeof useI18n>['t']): string {
  if (!b.agreementSigned) return t('fa15.agreementNotSigned');
  const status = b.paused
    ? t('fa15.paused')
    : b.verificationStatus === 'verified'
      ? t('fa15.verified')
      : b.canShowCandidates
        ? t('fa15.onboardedToday')
        : t('fa15.notVerified');
  const roles = b.vacancies
    .filter((v) => v.status === 'open')
    .map((v) => (v.headcount > 1 ? `${v.trade} × ${v.headcount}` : v.trade))
    .join(', ');
  return roles ? `${status} · ${roles}` : status;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
