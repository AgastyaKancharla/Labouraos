import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Card, EmptyState, ErrorState, IconTile, ListRow, LoadingState, ProgressBar, Screen, StatusChip, Text, type IconName } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { MetricPace } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthProvider';
import { type Accent, accents, colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { useTargetDashboard } from '../FA03-Home/useHome';

/**
 * FA12 — My targets, counted from records (placements closed, replacements
 * filled in 15 days, repeat businesses), the job seekers he activated (shown
 * for interest, no target — decided 11 Nov), and the leaderboard on
 * placements closed, which never shows anyone's target.
 */
/** Friendly medals for the top three on the leaderboard (the position number stays in the words). */
const MEDALS: Record<number, string | undefined> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function TargetsScreen() {
  const { t } = useI18n();
  const { session } = useAuth();
  const { fieldWork, visits } = useEndpoints();
  const dashboard = useTargetDashboard();
  const extra = useQuery({ queryKey: queryKeys.fieldTargets, queryFn: () => fieldWork.targets() });
  const board = useQuery({ queryKey: queryKeys.leaderboard, queryFn: () => visits.leaderboard() });
  const month = dashboard.data?.period.month ?? extra.data?.month;

  function metric(m: MetricPace | undefined, label: string, testID: string, look: { icon: IconName; accent: Accent }, showPace = false) {
    const achieved = m?.achieved ?? 0;
    const target = m?.effectiveTarget ?? null;
    return (
      <Card testID={testID} stripe accent={m?.isBehindPace ? 'orange' : look.accent}>
        <View style={styles.row}>
          <IconTile icon={look.icon} accent={look.accent} size={34} />
          <Text variant="bodyStrong" style={styles.flex1}>{label}</Text>
          <Text variant="stat">{target !== null ? `${achieved} / ${target}` : String(achieved)}</Text>
        </View>
        {target ? (
          <ProgressBar value={achieved / target} color={m?.isBehindPace ? colors.orangeRaw : accents[look.accent].raw} />
        ) : (
          <Text variant="muted">{t('fa03.noTarget')}</Text>
        )}
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
            {metric(metrics?.placementsClosed, t('fa12.placements'), 'fa12-placements', { icon: 'trophy', accent: 'green' }, true)}
            {metric(metrics?.replacementsInside15Days, t('fa12.replacements'), 'fa12-replacements', { icon: 'users', accent: 'cyan' })}
            {metric(metrics?.repeatBusinesses, t('fa12.repeat'), 'fa12-repeat', { icon: 'store', accent: 'gold' })}
          </>
        )}
        <Card testID="fa12-activated" stripe accent="royal">
          <View style={styles.row}>
            <IconTile icon="user-plus" accent="royal" size={34} />
            <Text variant="bodyStrong" style={styles.flex1}>{t('fa12.activated')}</Text>
            <Text variant="stat">{extra.data ? String(extra.data.candidatesActivated) : t('common.placeholderValue')}</Text>
          </View>
          <Text variant="muted">{t('fa12.activatedNote')}</Text>
        </Card>
        <Card title={t('fa12.leaderboard')} icon="trophy" accent="gold" testID="fa12-leaderboard">
          {board.isPending ? <LoadingState compact /> : null}
          {board.data && board.data.leaderboard.length === 0 ? <EmptyState compact /> : null}
          {(board.data?.leaderboard ?? []).slice(0, 10).map((row, i, all) => (
            <ListRow
              key={row.staffId}
              title={`${row.position}. ${row.staffId === session?.staff.id ? t('fa12.you') : row.name}`}
              leading={<IconTile emoji={MEDALS[row.position]} icon={MEDALS[row.position] ? undefined : 'user'} accent={row.staffId === session?.staff.id ? 'royal' : row.position <= 3 ? 'gold' : 'navy'} size={34} />}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  pace: { marginTop: 8 },
});
