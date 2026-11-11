import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Card, EmptyState, ErrorState, ListRow, LoadingState, ProgressBar, Screen, StatusChip, Text } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { MetricPace } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthProvider';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { useTargetDashboard } from '../FA03-Home/useHome';

/**
 * FA12 — My targets, counted from records (placements closed, replacements
 * filled in 15 days, repeat businesses), the job seekers he activated (shown
 * for interest, no target — decided 11 Nov), and the leaderboard on
 * placements closed, which never shows anyone's target.
 */
export default function TargetsScreen() {
  const { t } = useI18n();
  const { session } = useAuth();
  const { fieldWork, visits } = useEndpoints();
  const dashboard = useTargetDashboard();
  const extra = useQuery({ queryKey: queryKeys.fieldTargets, queryFn: () => fieldWork.targets() });
  const board = useQuery({ queryKey: queryKeys.leaderboard, queryFn: () => visits.leaderboard() });
  const month = dashboard.data?.period.month ?? extra.data?.month;

  function metric(m: MetricPace | undefined, label: string, testID: string, showPace = false) {
    const achieved = m?.achieved ?? 0;
    const target = m?.effectiveTarget ?? null;
    return (
      <Card testID={testID}>
        <View style={styles.row}>
          <Text variant="bodyStrong" style={styles.flex1}>{label}</Text>
          <Text variant="stat">{target !== null ? `${achieved} / ${target}` : String(achieved)}</Text>
        </View>
        {target ? <ProgressBar value={achieved / target} color={m?.isBehindPace ? colors.crit : colors.blue} /> : <Text variant="muted">{t('fa03.noTarget')}</Text>}
        {showPace && target ? (
          <View style={styles.pace}>
            <StatusChip tone={m?.isBehindPace ? 'crit' : 'green'} label={m?.isBehindPace ? t('fa12.behind') : t('fa12.onPace')} />
          </View>
        ) : null}
      </Card>
    );
  }

  const metrics = dashboard.data?.agent?.metrics;
  return (
    <View style={styles.flex} testID="screen-FA12">
      <AppHeader title={t('fa12.title', { month: month ? t(`month.${month}` as 'month.1') : '' })} />
      <Screen onRefresh={() => void dashboard.refetch()} refreshing={dashboard.isRefetching}>
        {dashboard.isPending ? (
          <LoadingState />
        ) : dashboard.isError ? (
          <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
        ) : (
          <>
            {metric(metrics?.placementsClosed, t('fa12.placements'), 'fa12-placements', true)}
            {metric(metrics?.replacementsInside15Days, t('fa12.replacements'), 'fa12-replacements')}
            {metric(metrics?.repeatBusinesses, t('fa12.repeat'), 'fa12-repeat')}
          </>
        )}
        <Card testID="fa12-activated">
          <View style={styles.row}>
            <Text variant="bodyStrong" style={styles.flex1}>{t('fa12.activated')}</Text>
            <Text variant="stat">{extra.data ? String(extra.data.candidatesActivated) : t('common.placeholderValue')}</Text>
          </View>
          <Text variant="muted">{t('fa12.activatedNote')}</Text>
        </Card>
        <Card title={t('fa12.leaderboard')} testID="fa12-leaderboard">
          {board.isPending ? <LoadingState compact /> : null}
          {board.data && board.data.leaderboard.length === 0 ? <EmptyState compact /> : null}
          {(board.data?.leaderboard ?? []).slice(0, 10).map((row, i, all) => (
            <ListRow
              key={row.staffId}
              title={`${row.position}. ${row.staffId === session?.staff.id ? t('fa12.you') : row.name}`}
              trailing={<Text variant="bodyStrong">{String(row.placementsClosed)}</Text>}
              last={i === all.length - 1}
            />
          ))}
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 },
  pace: { marginTop: 8 },
});
