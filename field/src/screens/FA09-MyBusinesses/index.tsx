import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Card, EmptyState, ErrorState, IconTile, LoadingState, Screen, SearchBar, Text, TextField, SendBySms, type SendChannel } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAfterSave } from '@/api/refresh';
import type { BusinessRowState, MyBusinessRow } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { businessTypeLabel } from '@/lib/businessTypes';
import { useDebounced } from '@/lib/useDebounced';
import { pageRoutes, routes } from '@/navigation/routes';
import { useSellingRoutes } from '@/navigation/useFlow';
import { colors, type Tone } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { Sheet } from '../_attendance/DayControls';
import { AddShiftForm } from '../_business/Shifts';
import { istDateKey } from '../_visits/format';
import { countGroups, DoneMark, filterRows, FilterChips, PersonRow, RowButton, useListFilter, WaitingMark } from '../_lists';

type T = ReturnType<typeof useI18n>['t'];

/**
 * Where a business is stuck, in one badge (Master Guide rev 208, 22 Nov):
 * Agreement not signed, Team Lead check, No vacancy, Ready to show
 * candidates, Interviews today, or All good. (Kept for the older rows; the
 * list now shows the server's plain status line, `businessStatusText`.)
 */
export function businessBadge(row: MyBusinessRow, t: T): { label: string; tone: Tone } {
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

/** The business's one plain status line ("Agreement not signed", "No vacancy yet", "Ready to show candidates"…). */
export function businessStatusText(row: BusinessRowState, t: T): string {
  return t(`lists.biz.status.${row.status}` as MessageKey);
}

/** The colour of the status line: stopped or unsigned red, waiting amber, ready and all good green. */
function statusTone(row: BusinessRowState): 'red' | 'amber' | 'green' | 'ink' {
  if (['suspended', 'paused', 'agreement_not_sent', 'agreement_waiting', 'agreement_expired'].includes(row.status)) return 'red';
  if (row.waiting || row.status === 'vacancy_to_confirm' || row.status === 'not_verified') return 'amber';
  if (row.status === 'ready' || row.done) return 'green';
  return 'ink';
}

/** "Visited today / yesterday / 3 days ago", in IST days. */
export function visitedText(lastVisitAt: string | null | undefined, t: T, now = Date.now()): string {
  if (!lastVisitAt) return t('lists.biz.notVisited');
  const days = Math.round((Date.parse(`${istDateKey(now)}T00:00:00Z`) - Date.parse(`${istDateKey(lastVisitAt)}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return t('lists.biz.visitedToday');
  if (days === 1) return t('lists.biz.visitedYesterday');
  return t('lists.biz.visitedDaysAgo', { count: days });
}

/**
 * FA09 — My businesses, the Businesses tab's main page. ALWAYS this list
 * (22 Nov, rev 208; the tab is reset to it on every tap, see the tabs layout).
 * Laboura Field lists (decided 22 Nov evening): search on top, filter chips
 * (All · Needs action · Waiting for Team Lead · Active · Done), needs-action
 * rows first. Each row: the name in bold, "Type · area", one plain status
 * line, "N vacancies · N candidates shown · N interviews today", the last
 * visit (red when a revisit is overdue), the BZ- code small; on the right a
 * green Done, "Waiting" (the Team Lead) or ONE next-step button that works
 * right there (Send agreement link, Confirm vacancy, Add shifts, Add vacancy,
 * Show candidates, Record a visit). Tapping the row opens the business page.
 * Data: GET /field-work/businesses?q=.
 */
export default function MyBusinessesScreen() {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const [text, setText] = useState('');
  const [filter, setFilter] = useListFilter();
  const q = useDebounced(text.trim());
  const list = useQuery({ queryKey: queryKeys.myBusinesses(q), queryFn: () => redesign.myBusinesses(q) });
  const rows = list.data?.results ?? [];
  const shown = filterRows(rows, filter);
  return (
    <View style={styles.flex} testID="screen-FA09">
      <AppHeader title={t('fa09.title')} root />
      <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
        <TextField label={t('fa09.filter')} value={text} onChangeText={setText} placeholder={t('fa09.filterPlaceholder')} autoCorrect={false} testID="fa09-filter" />
        <SearchBar onPress={() => router.push(routes.businessesSearch)} placeholder={t('common.searchEveryone')} />
        <FilterChips value={filter} onChange={setFilter} counts={countGroups(rows)} testID="fa09-chips" />
        <Card title={t('fa09.mine')} icon="store" accent="royal" testID="fa09-list">
          {list.isPending ? (
            <LoadingState compact />
          ) : list.isError ? (
            <ErrorState compact error={list.error} onRetry={() => void list.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState compact emoji="🏪" message={q ? t('fa09.noMatch') : t('fa09.none')} />
          ) : shown.length === 0 ? (
            <EmptyState compact emoji="✅" message={t('lists.noneHere')} />
          ) : (
            shown.map((b, i, all) => <BusinessRow key={b.id} b={b} last={i === all.length - 1} />)
          )}
        </Card>
      </Screen>
    </View>
  );
}

function BusinessRow({ b, last }: { b: MyBusinessRow; last: boolean }) {
  const { t } = useI18n();
  const row: BusinessRowState = b.row ?? { status: 'all_good', action: null, vacancyId: null, waiting: false, done: false, group: 'active' };
  const type = businessTypeLabel(b.businessType, b.businessTypeOther);
  return (
    <PersonRow
      leading={<IconTile icon="store" accent={b.agreementSigned ? 'royal' : 'gold'} size={40} />}
      name={b.name}
      status={businessStatusText(row, t)}
      statusTone={statusTone(row)}
      lines={[
        { text: [type, b.locality].filter(Boolean).join(' · ') },
        { text: t('lists.biz.numbers', { vacancies: b.openVacancies, shown: b.candidatesShown ?? 0, interviews: b.interviewsToday ?? 0 }) },
        {
          text: `${visitedText(b.lastVisitAt, t)}${b.revisitOverdue ? ` · ${t('lists.biz.revisitOverdue')}` : ''}`,
          tone: b.revisitOverdue ? 'red' : undefined,
        },
      ]}
      small={b.code}
      trailing={<BusinessRowEnd b={b} row={row} />}
      onPress={() => router.push(pageRoutes.business(b.id))}
      last={last}
      testID={`fa09-business-${b.id}`}
    />
  );
}

/** Done, Waiting, or the row's ONE next-step button, working right there (also on the business page's "Where it's stuck"). */
export function BusinessRowEnd({ b, row, testPrefix = 'fa09' }: { b: { id: string; name: string }; row: BusinessRowState; testPrefix?: string }) {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const queue = useOfflineQueue();
  const afterSave = useAfterSave();
  const sr = useSellingRoutes();
  const [shiftsOpen, setShiftsOpen] = useState(false);
  // Rev 211: the row's button sends on WhatsApp first (SMS as backup); "Send by SMS" under it.
  const send = useMutation({ mutationFn: (channel: SendChannel) => queue.live(() => redesign.resendAgreement(b.id, channel)), onSuccess: () => afterSave() });
  const id = `${testPrefix}-action-${b.id}`;
  if (row.waiting) return <WaitingMark testID={`${testPrefix}-waiting-${b.id}`} />;
  if (!row.action) return row.done ? <DoneMark testID={`${testPrefix}-done-${b.id}`} /> : null;
  const label = t(`lists.biz.action.${row.action}` as MessageKey);
  switch (row.action) {
    case 'agreement_link':
      return (
        <View style={styles.end}>
          <RowButton label={send.isSuccess ? t('lists.sent') : label} loading={send.isPending} disabled={send.isSuccess} onPress={() => send.mutate('whatsapp')} testID={id} />
          {!send.isSuccess ? <SendBySms sentAt={0} disabled={send.isPending} onPress={() => send.mutate('sms')} testID={`${id}-sms`} /> : null}
          {send.isError ? (
            <Text variant="tiny" color={colors.tomato} style={styles.endError} testID={`${id}-error`}>
              {t('lists.sendFailed')}
            </Text>
          ) : null}
        </View>
      );
    case 'add_shifts':
      return (
        <>
          <RowButton label={label} onPress={() => setShiftsOpen(true)} testID={id} />
          <Sheet open={shiftsOpen} onClose={() => setShiftsOpen(false)} title={t('lists.biz.addShiftsTitle', { name: b.name })}>
            <AddShiftForm
              businessId={b.id}
              onAdded={() => {
                setShiftsOpen(false);
                afterSave();
              }}
              onCancel={() => setShiftsOpen(false)}
              testID={`${id}-form`}
            />
          </Sheet>
        </>
      );
    case 'confirm_vacancy':
      return row.vacancyId ? <RowButton label={label} onPress={() => router.push(sr.confirmVacancy(row.vacancyId!))} testID={id} /> : null;
    case 'add_vacancy':
      return <RowButton label={label} onPress={() => router.push(sr.addVacancy(b.id))} testID={id} />;
    case 'show_candidates':
      return <RowButton label={label} onPress={() => router.push(sr.matches(b.id, row.vacancyId ?? undefined))} testID={id} />;
    case 'record_visit':
      return <RowButton label={label} onPress={() => router.push({ pathname: routes.visitStart, params: { businessId: b.id, name: b.name } })} testID={id} />;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  end: { alignItems: 'flex-end', gap: 2, maxWidth: 124 },
  endError: { textAlign: 'right' },
});
