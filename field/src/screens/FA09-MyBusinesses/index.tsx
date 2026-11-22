import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Card, EmptyState, ErrorState, Icon, IconTile, ListRow, LoadingState, Screen, SearchBar, StatusChip, TextField } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { MyBusinessRow } from '@/api/endpoints';
import { useDebounced } from '@/lib/useDebounced';
import { pageRoutes, routes } from '@/navigation/routes';
import { colors, type Tone } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { nextStepText } from '../FA08-Business';

/**
 * Where a business is stuck, in one badge (Master Guide rev 208, 22 Nov):
 * Agreement not signed, Team Lead check, No vacancy, Ready to show
 * candidates, Interviews today, or All good.
 */
export function businessBadge(row: MyBusinessRow, t: ReturnType<typeof useI18n>['t']): { label: string; tone: Tone } {
  const step = row.nextStep;
  switch (step.kind) {
    case 'suspended':
      return { label: t('biz.badge.suspended'), tone: 'tomato' };
    case 'paused':
      return { label: t('biz.badge.paused'), tone: 'tomato' };
    case 'agreement_waiting':
      return { label: t('biz.badge.agreement'), tone: 'tomato' };
    case 'waiting_tl_check':
    case 'candidates_hidden':
      return { label: t('biz.badge.tlCheck'), tone: 'amber' };
    default:
      break;
  }
  if ((row.interviewsToday ?? 0) > 0) return { label: t('biz.badge.interviewsToday'), tone: 'blue' };
  switch (step.kind) {
    case 'vacancy_to_confirm':
    case 'vacancy_to_send':
      return { label: t('biz.badge.vacancyWaiting'), tone: 'amber' };
    case 'add_vacancy':
      return { label: t('biz.badge.noVacancy'), tone: 'neutral' };
    case 'ready_show_candidates':
      return { label: t('biz.badge.ready'), tone: 'green' };
    default:
      return { label: t('biz.badge.allGood'), tone: 'green' };
  }
}

/** The colour of a business's next step: ready green, waiting on the owner amber, stopped red, nothing grey. */
export function nextTone(row: MyBusinessRow): Tone {
  switch (row.nextStep.kind) {
    case 'ready_show_candidates':
      return 'green';
    case 'suspended':
    case 'paused':
      return 'tomato';
    case 'agreement_waiting':
      return row.nextStep.agreementState === 'link_sent' ? 'amber' : 'tomato';
    case 'vacancy_to_confirm':
    case 'vacancy_to_send':
    case 'candidates_hidden':
    case 'waiting_tl_check':
      return 'amber';
    case 'add_vacancy':
      return 'blue';
    default:
      return 'neutral';
  }
}

/**
 * FA09 — My businesses, the Businesses tab's main page (redesign, 16 Nov;
 * 22 Nov, rev 208: always this list, never the last business page): the
 * agent's businesses (account agent, or onboarded by him), search on top,
 * each with its area, what it needs next and a badge where it is stuck.
 * Tapping one opens the one business page. The search box filters them by
 * name, BZ- code or area; "Search everyone" finds any record.
 * Data: GET /field-work/businesses?q=.
 */
export default function MyBusinessesScreen() {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const list = useQuery({ queryKey: queryKeys.myBusinesses(q), queryFn: () => redesign.myBusinesses(q) });
  return (
    <View style={styles.flex} testID="screen-FA09">
      <AppHeader title={t('fa09.title')} root />
      <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
        <TextField label={t('fa09.filter')} value={text} onChangeText={setText} placeholder={t('fa09.filterPlaceholder')} autoCorrect={false} testID="fa09-filter" />
        <SearchBar onPress={() => router.push(routes.businessesSearch)} placeholder={t('common.searchEveryone')} />
        <Card title={t('fa09.mine')} icon="store" accent="royal" testID="fa09-list">
          {list.isPending ? (
            <LoadingState compact />
          ) : list.isError ? (
            <ErrorState compact error={list.error} onRetry={() => void list.refetch()} />
          ) : list.data.results.length === 0 ? (
            <EmptyState compact emoji="🏪" message={q ? t('fa09.noMatch') : t('fa09.none')} />
          ) : (
            list.data.results.map((b, i, all) => (
              <ListRow
                key={b.id}
                title={b.name}
                subtitle={`${[b.locality, b.code].filter(Boolean).join(' · ')}\n${nextStepText(b.nextStep, t)}${b.openVacancies > 0 ? ` · ${t('fa09.open', { count: b.openVacancies })}` : ''}`}
                leading={<IconTile icon="store" accent={b.agreementSigned ? 'royal' : 'gold'} size={36} />}
                trailing={
                  <View style={styles.trailing}>
                    <StatusChip tone={businessBadge(b, t).tone} label={businessBadge(b, t).label} />
                    <Icon name="chevron-right" size={16} />
                  </View>
                }
                onPress={() => router.push(pageRoutes.business(b.id))}
                last={i === all.length - 1}
                testID={`fa09-business-${b.id}`}
              />
            ))
          )}
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
