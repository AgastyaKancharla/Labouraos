import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, IconTile, ListRow, LoadingState, Screen, StatusChip, TextField } from '@/components';
import { DateField, todayKeyIst } from '@/components/form';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { AllVisitRow, AllVisitsPage } from '@/api/endpoints';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { useDebounced } from '@/lib/useDebounced';
import { pageRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { istDateKey, minutesOf } from '../_visits/format';
import { outcomeKey } from '../_visits/labels';

/**
 * FA05c — All visits (17 Nov, Master Guide rev 193): the agent's whole visit
 * history beside Today and Yesterday on My visits, newest first, with a
 * search (shop name, area, BZ- code) and a From / To date filter. Each row
 * opens the visit's details. Data: GET /field-work/visits/all (paged).
 */
export default function AllVisitsScreen() {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useDebounced(text.trim());
  const today = todayKeyIst();
  const list = useInfiniteQuery<AllVisitsPage>({
    queryKey: queryKeys.allVisits(q, from, to),
    queryFn: ({ pageParam }) => redesign.allVisits({ q, from: from || undefined, to: to || undefined, before: (pageParam as string | null) ?? undefined }),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextBefore,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(q || from || to);

  return (
    <View style={styles.flex} testID="screen-FA05c">
      <AppHeader title={t('visits.allTitle')} />
      <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching && !list.isFetchingNextPage}>
        <TextField
          label={t('visits.searchLabel')}
          value={text}
          onChangeText={setText}
          placeholder={t('visits.searchPlaceholder')}
          autoCorrect={false}
          testID="all-visits-search"
        />
        <View style={styles.dates}>
          <View style={styles.date}>
            <DateField label={t('visits.from')} value={from} onChange={setFrom} max={to || today} testID="all-visits-from" />
          </View>
          <View style={styles.date}>
            <DateField label={t('visits.to')} value={to} onChange={setTo} min={from || undefined} max={today} testID="all-visits-to" />
          </View>
        </View>
        {from || to ? (
          <Button label={t('visits.clearDates')} variant="secondary" onPress={() => (setFrom(''), setTo(''))} testID="all-visits-clear" />
        ) : null}
        <Card testID="all-visits">
          {list.isPending ? <LoadingState compact /> : null}
          {list.isError ? <ErrorState compact error={list.error} onRetry={() => void list.refetch()} /> : null}
          {list.isSuccess && rows.length === 0 ? <EmptyState compact emoji="👟" message={filtered ? t('visits.none') : t('visits.noneYet')} /> : null}
          {rows.map((v, i) => (
            <VisitRow key={v.id} v={v} today={today} last={i === rows.length - 1 && !list.hasNextPage} />
          ))}
          {list.hasNextPage ? (
            <Button
              label={t('visits.loadMore')}
              variant="secondary"
              loading={list.isFetchingNextPage}
              onPress={() => void list.fetchNextPage()}
              testID="all-visits-more"
            />
          ) : null}
        </Card>
      </Screen>
    </View>
  );
}

function VisitRow({ v, today, last }: { v: AllVisitRow; today: string; last: boolean }) {
  const { t } = useI18n();
  const m = minutesOf(v.durationSeconds);
  // A visit from an earlier year shows its year ("Sun 1 Mar 2025"): the list goes back without limit.
  const day = istDateKey(v.at);
  const year = day.slice(0, 4) !== today.slice(0, 4) ? ` ${day.slice(0, 4)}` : '';
  const when = day === today ? `${t('date.today')} ${formatTimeIst(v.at)}` : `${formatDayIst(v.at)}${year} ${formatTimeIst(v.at)}`;
  const unfinished = v.status === 'unfinished';
  return (
    <ListRow
      title={v.title}
      subtitle={[when, v.subtitle, v.businessCode, m !== null ? t('common.minutes', { minutes: m }) : null].filter(Boolean).join(' · ')}
      leading={<IconTile icon={v.status === 'onboarded' ? 'check-circle' : unfinished ? 'clipboard' : 'store'} accent={v.status === 'onboarded' ? 'green' : unfinished ? 'gold' : 'royal'} size={34} />}
      trailing={
        <StatusChip
          tone={unfinished ? 'amber' : v.status === 'onboarded' ? 'green' : v.status === 'already_onboarded' ? 'blue' : 'neutral'}
          label={unfinished ? t('work.unfinished') : t(outcomeKey(v.status))}
        />
      }
      onPress={() => router.push(pageRoutes.visitDetails(v.id, '/visit'))}
      last={last}
      testID={`all-visit-${v.id}`}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  dates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  date: { flexBasis: '45%', flexGrow: 1, minWidth: 140 },
});
