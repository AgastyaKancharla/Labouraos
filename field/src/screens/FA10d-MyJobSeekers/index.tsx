import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, Icon, IconTile, ListRow, LoadingState, Screen, SearchBar, StatusChip, TextField } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { MyJobSeekerRow } from '@/api/endpoints';
import { useDebounced } from '@/lib/useDebounced';
import { pageRoutes, routes } from '@/navigation/routes';
import { colors, type Tone } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';

/** "Link sent ✓ · Consent ✓ · Paid ✓ · ID check pending · 2 interviews": where a job seeker is. */
export function seekerProgressLine(js: MyJobSeekerRow, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  const s = js.steps;
  const tick = (done: boolean, key: MessageKey) => `${t(key)}${done ? ' ✓' : ''}`;
  const parts = [
    tick(Boolean(s.linkSentAt), 'fa10d.linkSent'),
    tick(Boolean(s.consentGivenAt), 'fa10d.consent'),
    tick(Boolean(s.paidAt), 'fa10d.paid'),
    s.idCheckedAt ? tick(true, 'fa10d.idChecked') : s.idCheckPending ? t('fa10d.idPending') : t('fa10d.idChecked'),
  ];
  if (s.interviews > 0) parts.push(t('fa10d.interviews', { count: s.interviews }));
  return parts.join(' · ');
}

const STAGE_TONE: Record<MyJobSeekerRow['stage'], Tone> = {
  registered: 'neutral',
  link_sent: 'amber',
  consent_given: 'amber',
  paid: 'cyan',
  id_checked: 'blue',
  interviewing: 'blue',
  placed: 'green',
  inactive: 'tomato',
};

/**
 * FA10d — My job seekers, the Job seekers tab's main page (redesign, 16 Nov):
 * the job seekers this agent registered, each with where they are (link
 * sent, consent given, paid, ID checked, interviews), + Job seeker and
 * + Referral partner. The search box filters by name, JS- code or the last 4
 * digits; "Search everyone" finds any record.
 * Data: GET /field-work/job-seekers?q=.
 */
export default function MyJobSeekersScreen() {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const list = useQuery({ queryKey: queryKeys.myJobSeekers(q), queryFn: () => redesign.myJobSeekers(q) });
  return (
    <View style={styles.flex} testID="screen-FA10d">
      <AppHeader title={t('fa10d.title')} root />
      <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
        <View style={styles.row}>
          <Button label={t('fa03.addJobSeeker')} icon={<Icon name="user-plus" color={colors.white} />} style={styles.flex1} onPress={() => router.push(routes.jobSeekerNew)} testID="fa10d-add" />
          <Button label={t('today.addReferral')} variant="secondary" icon={<Icon name="users" color={colors.greenText} />} style={styles.flex1} onPress={() => router.push(routes.referralNew)} testID="fa10d-referral" />
        </View>
        <TextField label={t('fa10d.filter')} value={text} onChangeText={setText} placeholder={t('fa10d.filterPlaceholder')} autoCorrect={false} testID="fa10d-filter" />
        <SearchBar onPress={() => router.push(routes.jobSeekersSearch)} placeholder={t('common.searchEveryone')} />
        <Card title={t('fa10d.mine')} icon="users" accent="cyan" testID="fa10d-list">
          {list.isPending ? (
            <LoadingState compact />
          ) : list.isError ? (
            <ErrorState compact error={list.error} onRetry={() => void list.refetch()} />
          ) : list.data.results.length === 0 ? (
            <EmptyState compact emoji="🧑‍🔧" message={q ? t('fa10d.noMatch') : t('fa10d.none')} />
          ) : (
            list.data.results.map((js, i, all) => (
              <ListRow
                key={js.id}
                title={js.name}
                subtitle={`${[js.code, js.phoneLast4 ? `******${js.phoneLast4}` : null].filter(Boolean).join(' · ')}\n${seekerProgressLine(js, t)}`}
                leading={<IconTile icon="user" accent={js.stage === 'placed' ? 'green' : js.stage === 'inactive' ? 'red' : 'cyan'} size={36} />}
                trailing={<StatusChip tone={STAGE_TONE[js.stage] ?? 'neutral'} label={t(`fa10d.stage.${js.stage}` as MessageKey)} />}
                onPress={() => router.push(pageRoutes.seekerProgress(js.id))}
                last={i === all.length - 1}
                testID={`fa10d-seeker-${js.id}`}
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
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: 8 },
});
