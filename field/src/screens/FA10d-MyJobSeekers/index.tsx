import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, Icon, LoadingState, Screen, Text, TextField, SendBySms, type SendChannel } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAfterSave } from '@/api/refresh';
import type { GuaranteeDay, MyJobSeekerRow, SeekerRowState } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { useDebounced } from '@/lib/useDebounced';
import { pageRoutes, routes, sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { Avatar, countGroups, DoneMark, filterRows, FilterChips, PersonRow, RowButton, SortChips, sortList, useListFilter, useListSort, WaitingMark } from '../_lists';

type T = ReturnType<typeof useI18n>['t'];

/** His one plain status line ("Waiting for the Team Lead's ID check", "Stuck at payment", "Active"…). */
export function seekerStatusText(row: SeekerRowState, t: T): string {
  return t(`lists.js.status.${row.status}` as MessageKey);
}

/** "Cook · Bommanahalli · 1 yr". */
export function seekerTradeLine(s: { trade?: string | null; locality?: string | null; yearsExperience?: number | null }, t: T): string {
  const years = s.yearsExperience ? t(s.yearsExperience === 1 ? 'lists.js.year' : 'lists.js.years', { count: s.yearsExperience }) : null;
  return [s.trade, s.locality, years].filter(Boolean).join(' · ');
}

/** Once paid: "Day 5 of 30 · 2 hits", and the next interview when there is one. */
export function seekerGuaranteeLine(s: { guarantee?: GuaranteeDay | null; hits?: number; nextInterviewAt?: string | null }, t: T): string {
  const parts: string[] = [];
  if (s.guarantee) {
    parts.push(t('lists.js.dayOf', { day: s.guarantee.day, days: s.guarantee.days }));
    parts.push(t(s.hits === 1 ? 'lists.js.hit' : 'lists.js.hits', { count: s.hits ?? 0 }));
  }
  if (s.nextInterviewAt) parts.push(t('lists.js.nextInterview', { when: `${formatDayIst(s.nextInterviewAt)} ${formatTimeIst(s.nextInterviewAt)}` }));
  return parts.join(' · ');
}

function statusTone(row: SeekerRowState): 'red' | 'amber' | 'green' | 'ink' {
  if (row.waiting) return 'amber';
  if (row.status === 'stuck_payment' || row.status === 'id_stopped' || row.status === 'closed') return 'red';
  if (row.done) return 'green';
  return 'ink';
}

/**
 * FA10d — My job seekers, the Job seekers tab's main page (redesign, 16 Nov;
 * Laboura Field lists, decided 22 Nov evening): + Job seeker and + Referral
 * partner, search on top, filter chips (All · Needs action · Waiting for Team
 * Lead · Active · Done), needs-action rows first. Each row: his selfie (or
 * initials), the name in bold, "Trade · area · experience", one plain status
 * line (never the old "Link sent ✓ · Consent ✓ · Paid" checklist, which read
 * as if he had paid), once paid "Day X of 30 · N hits" and the next interview,
 * the JS- code and masked phone small; on the right a green Done, "Waiting"
 * (the Team Lead's ID check) or ONE next-step button that works right there
 * (Send / Resend link, Send payment link, Scan Aadhaar QR, Book interview).
 * Tapping the row opens his profile (FA10e), not the registration screen.
 * Data: GET /field-work/job-seekers?q=.
 */
export default function MyJobSeekersScreen() {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const [text, setText] = useState('');
  const [filter, setFilter] = useListFilter();
  const q = useDebounced(text.trim());
  const list = useQuery({ queryKey: queryKeys.myJobSeekers(q), queryFn: () => redesign.myJobSeekers(q) });
  const rows = list.data?.results ?? [];
  const [sort, setSort] = useListSort();
  const shown = sortList(filterRows(rows, filter), sort, (s) => s.registeredAt);
  return (
    <View style={styles.flex} testID="screen-FA10d">
      <AppHeader title={t('fa10d.title')} root />
      <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
        <View style={styles.row}>
          <Button label={t('fa03.addJobSeeker')} icon={<Icon name="user-plus" color={colors.white} />} style={styles.flex1} onPress={() => router.push(routes.jobSeekerNew)} testID="fa10d-add" />
          <Button label={t('today.addReferral')} variant="secondary" icon={<Icon name="users" color={colors.greenText} />} style={styles.flex1} onPress={() => router.push(routes.referralNew)} testID="fa10d-referral" />
        </View>
        <TextField label={t('fa10d.filter')} value={text} onChangeText={setText} placeholder={t('fa10d.filterPlaceholder')} autoCorrect={false} testID="fa10d-filter" />
        <FilterChips value={filter} onChange={setFilter} counts={countGroups(rows)} testID="fa10d-chips" />
        <SortChips value={sort} onChange={setSort} testID="fa10d-sort" />
        <Card title={t('fa10d.mine')} icon="users" accent="cyan" testID="fa10d-list">
          {list.isPending ? (
            <LoadingState compact />
          ) : list.isError ? (
            <ErrorState compact error={list.error} onRetry={() => void list.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState compact emoji="🧑‍🔧" message={q ? t('fa10d.noMatch') : t('fa10d.none')} />
          ) : shown.length === 0 ? (
            <EmptyState compact emoji="✅" message={t('lists.noneHere')} />
          ) : (
            shown.map((js, i, all) => <SeekerRow key={js.id} js={js} last={i === all.length - 1} />)
          )}
        </Card>
      </Screen>
    </View>
  );
}

function SeekerRow({ js, last }: { js: MyJobSeekerRow; last: boolean }) {
  const { t } = useI18n();
  const row: SeekerRowState = js.row ?? { status: 'active', action: null, vacancyId: null, waiting: false, done: false, group: 'active' };
  return (
    <PersonRow
      leading={<Avatar name={js.name} photoUrl={js.photoUrl} testID={`fa10d-photo-${js.id}`} />}
      name={js.name}
      status={seekerStatusText(row, t)}
      statusTone={statusTone(row)}
      lines={[{ text: seekerTradeLine(js, t) }, { text: seekerGuaranteeLine(js, t) }]}
      small={[js.code, js.phoneLast4 ? `******${js.phoneLast4}` : null].filter(Boolean).join(' · ')}
      trailing={<SeekerRowEnd js={js} row={row} />}
      onPress={() => router.push(pageRoutes.seekerProfile(js.id))}
      last={last}
      testID={`fa10d-seeker-${js.id}`}
    />
  );
}

/** Done, Waiting, or the row's ONE next-step button, working right there. */
export function SeekerRowEnd({ js, row, testPrefix = 'fa10d' }: { js: { id: string }; row: SeekerRowState; testPrefix?: string }) {
  const { t } = useI18n();
  const { selling, people } = useEndpoints();
  const queue = useOfflineQueue();
  const afterSave = useAfterSave();
  // Rev 211: the row's button sends on WhatsApp first (SMS as backup); "Send by SMS" under it.
  const send = useMutation({
    mutationFn: ({ kind, channel }: { kind: 'registration_link' | 'payment_link'; channel: SendChannel }) =>
      queue.live<unknown>(() => (kind === 'registration_link' ? selling.sendRegistrationLink(js.id, channel) : people.sendPaymentLink(js.id, channel))),
    onSuccess: () => afterSave(),
  });
  const id = `${testPrefix}-action-${js.id}`;
  if (row.waiting) return <WaitingMark testID={`${testPrefix}-waiting-${js.id}`} />;
  if (!row.action) return row.done ? <DoneMark testID={`${testPrefix}-done-${js.id}`} /> : null;
  switch (row.action) {
    case 'registration_link':
    case 'payment_link': {
      const action = row.action;
      const label = action === 'registration_link' && row.status === 'link_not_sent' ? t('lists.js.action.sendLink') : t(`lists.js.action.${action}` as MessageKey);
      return (
        <View style={styles.end}>
          <RowButton label={send.isSuccess ? t('lists.sent') : label} loading={send.isPending} disabled={send.isSuccess} onPress={() => send.mutate({ kind: action, channel: 'whatsapp' })} testID={id} />
          {!send.isSuccess ? <SendBySms sentAt={0} disabled={send.isPending} onPress={() => send.mutate({ kind: action, channel: 'sms' })} testID={`${id}-sms`} /> : null}
          {send.isError ? (
            <Text variant="tiny" color={colors.tomato} style={styles.endError} testID={`${id}-error`}>
              {t('lists.sendFailed')}
            </Text>
          ) : null}
        </View>
      );
    }
    case 'scan_aadhaar':
      return <RowButton label={t('lists.js.action.scan_aadhaar')} onPress={() => router.push(pageRoutes.seekerProfile(js.id, 'scan'))} testID={id} />;
    case 'book_interview':
      return row.vacancyId ? <RowButton label={t('lists.js.action.book_interview')} onPress={() => router.push(sellingRoutes.book(row.vacancyId!, js.id))} testID={id} /> : null;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: 8 },
  end: { alignItems: 'flex-end', gap: 2, maxWidth: 124 },
  endError: { textAlign: 'right' },
});
