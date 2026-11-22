import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import {
  Banner, Button, Card, EmptyState, ErrorState, HeroCard, HeroPill, Icon, IconTile, ListRow, LoadingState, ProgressBar, Screen, SearchBar,
  StatGrid, StatTile, StatusChip, Text, type IconName,
} from '@/components';
import { useAuth } from '@/auth/AuthProvider';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useOfflineQueue } from '@/device/offline-queue';
import type { NeedsItem, TodayView } from '@/api/endpoints';
import type { DayKind } from '../_visits/DayWork';
import { formatDayIst, formatShiftTime, formatStampIst, formatTimeIst } from '@/lib/format';
import { pageRoutes, routes, sellingRoutes } from '@/navigation/routes';
import { type Accent, colors, fonts, fontSize } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { formatDateKey } from '../_visits/format';
import { useAttendanceToday } from './useHome';
import { DayControls } from '../_attendance/DayControls';
import { needsTarget } from './needsTarget';
import { groupNeeds, type NeedsGroup } from './groupNeeds';
import { Pressable } from 'react-native';
import { VerificationJobCard } from '../_visits/VerificationJobCard';

export { STATUS_CHOICES } from '../_attendance/DayControls';

/**
 * Today's numbers: each opens Today's work filtered on what it counts;
 * vacancies confirmed open My businesses (17 Nov: a confirmed vacancy is on
 * its business's history, not a row of Today's work).
 */
const NUMBERS: { key: keyof TodayView['numbers']; label: MessageKey; accent: Accent; kind?: DayKind }[] = [
  { key: 'shopsVisited', label: 'fa03.shopsVisited', accent: 'royal', kind: 'visit' },
  { key: 'onboarded', label: 'fa03.onboarded', accent: 'green', kind: 'onboarded' },
  { key: 'vacanciesConfirmed', label: 'today.vacanciesConfirmed', accent: 'gold' },
  { key: 'candidatesShown', label: 'fa03.shown', accent: 'cyan', kind: 'candidates_shown' },
  { key: 'interviewsBooked', label: 'today.interviews', accent: 'orange', kind: 'interview_booked' },
];

const NEEDS_LOOK: Record<NeedsItem['kind'], { icon: IconName; accent: Accent }> = {
  interview_today: { icon: 'calendar', accent: 'royal' },
  verification_visit: { icon: 'shield', accent: 'royal' },
  visit_unfinished: { icon: 'camera', accent: 'gold' },
  agreement_waiting: { icon: 'document', accent: 'orange' },
  vacancy_awaiting_owner: { icon: 'briefcase', accent: 'gold' },
  vacancy_draft: { icon: 'briefcase', accent: 'navy' },
  ready_show_candidates: { icon: 'users', accent: 'green' },
  vacancies_to_fill: { icon: 'briefcase', accent: 'orange' },
  joining_due: { icon: 'briefcase', accent: 'green' },
  revisit_due: { icon: 'store', accent: 'gold' },
  followup_task: { icon: 'phone', accent: 'royal' },
};

/**
 * FA03 — Today, the first tab (redesign, 16 Nov): Log in / Log out and the
 * status (DayControls, 17 Nov: login time, on time or late, the current
 * status — tap to change — and Log out, which ends the day); today's numbers, each opening Today's work; a small targets bar; the
 * quick buttons; and Needs you now: one list of everything waiting on the
 * agent, each opening the exact step of its job.
 *
 * Data: GET /attendance/today (+ login with GPS, status, logout),
 * GET /field-work/today (numbers, targets, Needs you now), and the offline
 * queue's "waiting to send" row.
 */
export default function TodayScreen() {
  const { t, tn } = useI18n();
  const { session, resetNotice, dismissResetNotice } = useAuth();
  const { redesign } = useEndpoints();
  const attendance = useAttendanceToday();
  const today = useQuery<TodayView>({ queryKey: queryKeys.today, queryFn: () => redesign.today(), enabled: session?.staff.role === 'field_agent' });
  const queue = useOfflineQueue();

  const [openedAt] = useState(() => Date.now());
  const name = session?.staff.name ?? '';
  const now = today.data?.now ?? attendance.data?.clocks.now ?? openedAt;
  const numbers = today.data?.numbers;
  const placeholder = t('common.placeholderValue');
  const targets = today.data?.targets ?? null;

  function refresh() {
    void attendance.refetch();
    void today.refetch();
    void queue.flush();
  }

  return (
    <View style={styles.flex}>
      <AppHeader title={t('today.title')} subtitle={`${name} · ${formatDayIst(now)}`} root />
      <Screen onRefresh={refresh} refreshing={today.isRefetching} testID="screen-FA03">
        {/* Once, after a password reset (rev 174–175): if it was not them, they tell their Team Lead at once. */}
        {resetNotice ? (
          <Banner
            tone="info"
            message={t('access.notice', { date: formatStampIst(resetNotice.at), name: resetNotice.byName ?? '—' })}
            action={<Button label={t('common.close')} variant="secondary" onPress={dismissResetNotice} />}
            testID="reset-notice"
          />
        ) : null}

        {/* 22 Nov (rev 207): no Logged in · late · Log out card here; the status is under the bell, Log out in Me. */}
        <DayControls compact />

        <SearchBar onPress={() => router.push(routes.search)} />

        <HeroCard eyebrow={t('fa03.today')} corner={<HeroPill label={formatDayIst(now)} />} testID="today-hero">
          <StatGrid>
            {NUMBERS.map((n) => (
              <StatTile
                key={n.key}
                accent={n.accent}
                value={numbers ? String(numbers[n.key]) : placeholder}
                label={t(n.label)}
                detail={n.key === 'interviewsBooked' && numbers ? t('today.attended', { count: numbers.interviewsAttended }) : undefined}
                onPress={() => router.push(n.kind ? pageRoutes.todaysWork(today.data?.date, n.kind) : routes.businesses)}
                testID={`stat-${n.key}`}
              />
            ))}
          </StatGrid>
          {targets ? (
            <View testID="targets-bar" style={styles.targets}>
              <View style={styles.targetsHead}>
                <IconTile icon="trophy" accent="gold" size={30} />
                <Text style={styles.onBlueLabel}>{t('fa03.placementsThisMonth')}</Text>
                <Text style={styles.onBlueStrong}>
                  {targets.placementsTarget !== null ? `${targets.placementsClosed} / ${targets.placementsTarget}` : `${targets.placementsClosed} · ${t('fa03.noTarget')}`}
                </Text>
              </View>
              <ProgressBar value={targets.placementsTarget ? targets.placementsClosed / targets.placementsTarget : 0} color={colors.gold} onBlue />
            </View>
          ) : null}
        </HeroCard>
        {today.isError ? <ErrorState error={today.error} onRetry={() => void today.refetch()} compact /> : null}

        <View style={styles.grid}>
          <Button label={t('fa03.visitShop')} icon={<Icon name="camera" color={colors.white} />} style={styles.full} onPress={() => router.push(routes.visitStart)} testID="quick-visit" />
          <Button label={t('fa03.addJobSeeker')} variant="secondary" icon={<Icon name="user-plus" color={colors.cyan} />} style={styles.cell} onPress={() => router.push(routes.jobSeekerNew)} testID="quick-job-seeker" />
          <Button label={t('fa03.addVacancy')} variant="secondary" icon={<Icon name="briefcase" color={colors.crit} />} style={styles.cell} onPress={() => router.push(sellingRoutes.addVacancy())} testID="quick-vacancy" />
          <Button label={t('today.addReferral')} variant="secondary" icon={<Icon name="users" color={colors.greenText} />} style={styles.cell} onPress={() => router.push(routes.referralNew)} testID="quick-referral" />
          <Button label={t('fa03.feeCalculator')} variant="secondary" icon={<Icon name="rupee" color={colors.amber} />} style={styles.cell} onPress={() => router.push(routes.feeCalculator)} testID="quick-fee" />
        </View>

        <Card title={t('today.needsYou')} icon="bell" accent="orange" testID="needs-you">
          {queue.summary.total > 0 ? (
            <ListRow
              title={queue.summary.failed > 0 ? t('fa03.waitingToSendFailed') : t('fa03.waitingToSend')}
              leading={<IconTile icon="wifi-off" accent={queue.summary.failed > 0 ? 'red' : 'gold'} size={34} />}
              trailing={
                <StatusChip
                  tone={queue.summary.failed > 0 ? 'tomato' : 'amber'}
                  label={queue.summary.sending ? t('queue.sending') : queue.summary.photos > 0 ? tn('queue.photos', queue.summary.photos) : tn('queue.items', queue.summary.forms)}
                />
              }
              onPress={() => void queue.flush()}
              last={(today.data?.needsYou.length ?? 0) === 0}
              testID="queue-row"
            />
          ) : null}
          {today.isPending ? <LoadingState compact /> : null}
          {today.data && today.data.needsYou.length === 0 && queue.summary.total === 0 ? <EmptyState compact emoji="✅" message={t('today.nothing')} /> : null}
          {groupNeeds(today.data?.needsYou ?? []).map((group, i, all) =>
            group.items.length === 1 ? (
              <NeedsRow key={group.key} item={group.items[0]} last={i === all.length - 1} />
            ) : (
              <NeedsGroupRow key={group.key} group={group} last={i === all.length - 1} />
            ),
          )}
        </Card>
      </Screen>
    </View>
  );
}

type T = ReturnType<typeof useI18n>['t'];
type TN = ReturnType<typeof useI18n>['tn'];

/** What an item of Needs you now is, in words ("Ready to show candidates · Waiter × 2"). */
function needsWhat(item: NeedsItem, t: T, tn: TN): string {
  const vacancy = item.vacancy ? (item.vacancy.headcount > 1 ? `${item.vacancy.trade} × ${item.vacancy.headcount}` : item.vacancy.trade) : null;
  const what =
    item.kind === 'interview_today' && item.interview
      ? item.interview.candidateArrivedAt
        ? t('needs.interview_arrived', { name: item.interview.candidateName })
        : t('needs.interview_today', { time: formatTimeIst(item.interview.startsAt), name: item.interview.candidateName })
      : item.kind === 'visit_unfinished'
        ? t(`needs.visit.${item.target.step ?? 'record_result'}` as MessageKey)
        : item.kind === 'agreement_waiting'
          ? t(item.agreement?.state === 'link_expired' ? 'needs.agreement_expired' : item.agreement?.state === 'not_sent' ? 'needs.agreement_not_sent' : 'needs.agreement_waiting')
          : item.kind === 'vacancies_to_fill'
            ? [tn('needs.vacancies_to_fill', item.toFill?.count ?? 0), item.toFill?.trades.join(', ')].filter(Boolean).join(' · ')
          : item.kind === 'joining_due' && item.placement
            ? t('needs.joining_due', { name: item.placement.candidateFirstName })
            : vacancy && (item.kind === 'vacancy_awaiting_owner' || item.kind === 'vacancy_draft' || item.kind === 'ready_show_candidates')
              ? t(`needs.${item.kind}` as MessageKey, { vacancy })
              : item.kind === 'followup_task' && item.kindLabel
                ? item.kindLabel
                : item.kind === 'revisit_due'
                  ? [
                      t('needs.revisit_due'),
                      item.revisitTime ? t('fa05.comeBackAt', { time: formatShiftTime(item.revisitTime) }) : null,
                      item.coverFor ? t('needs.coverFor', { name: item.coverFor }) : null,
                    ].filter(Boolean).join(' · ')
                  : t(`needs.${item.kind}` as MessageKey, { vacancy: '' });
  return what;
}

function dueText(item: Pick<NeedsItem, 'due' | 'kind' | 'revisitOn'>, t: T): string | null {
  return item.due === 'overdue'
    ? t('needs.overdue')
    : item.due === 'today'
      ? t('date.today')
      : item.due === 'tomorrow'
        ? t('date.tomorrow')
        : item.kind === 'revisit_due' && item.revisitOn
          ? formatDateKey(item.revisitOn)
          : null;
}

/** One item of Needs you now: what it is (in the agent's language), when, and where it opens. */
function NeedsRow({ item, last }: { item: NeedsItem; last: boolean }) {
  const { t, tn } = useI18n();
  // 21 Nov (M12): a verification visit shows as its job card (address, owner, Call owner, Open in Maps, Verify).
  if (item.kind === 'verification_visit' && item.job) return <VerificationJobCard job={item.job} testID={`needs-${item.id}`} />;
  const look = NEEDS_LOOK[item.kind] ?? { icon: 'bell', accent: 'navy' };
  const href = needsTarget(item);
  const what = needsWhat(item, t, tn);
  // A vacancy's trade is already in the sentence ("Waiting for the owner's code · Cook"): never twice (A8).
  const extra =
    (item.vacancy && item.subtitle?.trim().toLowerCase() === item.vacancy.trade.trim().toLowerCase()) ||
    (item.kind === 'followup_task' && item.subtitle === item.kindLabel)
      ? null
      : item.subtitle;
  const dueLabel = dueText(item, t);
  return (
    <ListRow
      title={item.title}
      subtitle={[what, extra].filter(Boolean).join(' · ')}
      leading={<IconTile icon={look.icon} accent={look.accent} size={34} />}
      trailing={dueLabel ? <StatusChip tone={item.due === 'overdue' ? 'tomato' : item.due === 'today' ? 'amber' : 'neutral'} label={dueLabel} /> : <Icon name="chevron-right" size={16} />}
      onPress={href ? () => router.push(href as never) : undefined}
      last={last}
      testID={`needs-${item.id}`}
    />
  );
}

/**
 * One business with several open items (22 Nov, owner's field test: never the
 * same shop three times): the name, then each item on its own line under it —
 * each line opens that exact step; the row itself opens the business page
 * (a shop not registered yet: its most urgent item).
 */
function NeedsGroupRow({ group, last }: { group: NeedsGroup; last: boolean }) {
  const { t, tn } = useI18n();
  const first = group.items[0];
  const look = NEEDS_LOOK[first.kind] ?? { icon: 'bell', accent: 'navy' };
  const open = group.businessId ? pageRoutes.business(group.businessId) : needsTarget(first);
  const due = group.due ? dueText({ due: group.due, kind: first.kind, revisitOn: null }, t) : null;
  return (
    <View testID={`needs-group-${group.key}`}>
      <ListRow
        title={group.title}
        subtitle={[
          ...group.items.map((i) => needsWhat(i, t, tn) + (i.due === 'overdue' ? ` (${t('needs.overdue').toLowerCase()})` : '')),
          group.items.find((i) => i.subtitle && !i.vacancy && i.kind !== 'followup_task')?.subtitle ?? null,
        ].filter(Boolean).join(' · ')}
        leading={<IconTile icon={look.icon} accent={look.accent} size={34} />}
        trailing={due ? <StatusChip tone={group.due === 'overdue' ? 'tomato' : group.due === 'today' ? 'amber' : 'neutral'} label={due} /> : <Icon name="chevron-right" size={16} />}
        onPress={open ? () => router.push(open as never) : undefined}
        last
        testID={`needs-group-${group.key}-open`}
      />
      <View style={[styles.subItems, last ? null : styles.groupDivider]}>
        {group.items.map((item) => {
          const href = needsTarget(item);
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${group.title}: ${needsWhat(item, t, tn)}`}
              onPress={href ? () => router.push(href as never) : undefined}
              style={styles.subItem}
              testID={`needs-${item.id}`}
            >
              <Text variant="small" style={styles.flex1}>{`• ${needsWhat(item, t, tn)}`}</Text>
              <Icon name="chevron-right" size={14} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  subItems: { paddingLeft: 46, paddingBottom: 6 },
  groupDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  subItem: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexBasis: '48%', flexGrow: 1 },
  full: { flexBasis: '100%' },
  targets: { gap: 8, paddingTop: 4 },
  targetsHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  onBlueLabel: { fontFamily: fonts.body700, fontSize: fontSize.label, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.onBlueSoft, flex: 1 },
  onBlueStrong: { fontFamily: fonts.display700, fontSize: 18, color: colors.white, fontVariant: ['tabular-nums'] },
});
