import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import {
  Banner, Button, Card, EmptyState, ErrorState, HeroCard, HeroPill, Icon, IconTile, ListRow, LoadingState, ProgressBar, Screen, SearchBar,
  StatGrid, StatTile, StatusChip, Text, type IconName,
} from '@/components';
import { useAuth } from '@/auth/AuthProvider';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useOfflineQueue } from '@/device/offline-queue';
import { LOCATION_ERROR_KEYS } from '@/device/location/useLocation';
import type { AttendanceToday, NeedsItem, TodayView } from '@/api/endpoints';
import type { DayKind } from '../_visits/DayWork';
import { formatDayIst, formatStampIst, formatShiftTime, formatTimeIst } from '@/lib/format';
import { pageRoutes, routes, sellingRoutes } from '@/navigation/routes';
import { type Accent, colors, fonts, fontSize, radius, touch } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ChoiceList } from '../_visits/ChoiceList';
import { formatDateKey } from '../_visits/format';
import { isLocationError, useAttendanceLogin, useAttendanceToday } from './useHome';
import { needsTarget } from './needsTarget';
import { attendanceErrorText, isPickableStatus, PICKABLE_STATUSES, statusLabel, type PickableStatus } from '@/lib/status';

/** The statuses the agent taps to change: exactly the ones a person may pick (fix list A2, lib/status). */
export const STATUS_CHOICES = PICKABLE_STATUSES;
const STATUS_ICON: Record<PickableStatus, { icon: IconName; accent: Accent }> = {
  available: { icon: 'check', accent: 'green' },
  team_meeting: { icon: 'users', accent: 'cyan' },
  training: { icon: 'document', accent: 'royal' },
  one_to_one: { icon: 'user', accent: 'navy' },
  system_problem: { icon: 'wifi-off', accent: 'red' },
  short_break: { icon: 'clock', accent: 'orange' },
  lunch: { icon: 'clock', accent: 'gold' },
};

/** Today's numbers: each opens Today's work filtered on what it counts. */
const NUMBERS: { key: keyof TodayView['numbers']; label: MessageKey; accent: Accent; kind: DayKind }[] = [
  { key: 'shopsVisited', label: 'fa03.shopsVisited', accent: 'royal', kind: 'visit' },
  { key: 'onboarded', label: 'fa03.onboarded', accent: 'green', kind: 'onboarded' },
  { key: 'vacanciesConfirmed', label: 'today.vacanciesConfirmed', accent: 'gold', kind: 'vacancy_confirmed' },
  { key: 'candidatesShown', label: 'fa03.shown', accent: 'cyan', kind: 'candidates_shown' },
  { key: 'interviewsBooked', label: 'today.interviews', accent: 'orange', kind: 'interview_booked' },
];

const NEEDS_LOOK: Record<NeedsItem['kind'], { icon: IconName; accent: Accent }> = {
  interview_today: { icon: 'calendar', accent: 'royal' },
  visit_unfinished: { icon: 'camera', accent: 'gold' },
  agreement_waiting: { icon: 'document', accent: 'orange' },
  vacancy_awaiting_owner: { icon: 'briefcase', accent: 'gold' },
  vacancy_draft: { icon: 'briefcase', accent: 'navy' },
  ready_show_candidates: { icon: 'users', accent: 'green' },
  joining_due: { icon: 'briefcase', accent: 'green' },
  revisit_due: { icon: 'store', accent: 'gold' },
  followup_task: { icon: 'phone', accent: 'royal' },
};

/**
 * FA03 — Today, the first tab (redesign, 16 Nov): the attendance bar (login
 * time, on time or late, the current status — tap to change — and End my
 * day); today's numbers, each opening Today's work; a small targets bar; the
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
  const login = useAttendanceLogin();
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

  const loginErrorMessage = login.error
    ? isLocationError(login.error)
      ? `${t('fa03.loginNeedsLocation')} ${t(LOCATION_ERROR_KEYS[login.error.code])}`
      : attendanceErrorText(login.error, 'today.loginFailed', t)
    : null;

  return (
    <View style={styles.flex}>
      <AppHeader title={t('today.title')} subtitle={`${name} · ${formatDayIst(now)}`} root />
      <Screen onRefresh={refresh} refreshing={today.isRefetching} testID="screen-FA03">
        {!queue.online ? <Banner tone="info" icon="wifi-off" message={t('common.offline')} testID="offline-banner" /> : null}
        {/* Once, after a password reset (rev 174–175): if it was not them, they tell their Team Lead at once. */}
        {resetNotice ? (
          <Banner
            tone="info"
            message={t('access.notice', { date: formatStampIst(resetNotice.at), name: resetNotice.byName ?? '—' })}
            action={<Button label={t('common.close')} variant="secondary" onPress={dismissResetNotice} />}
            testID="reset-notice"
          />
        ) : null}

        {attendance.isPending ? (
          <LoadingState compact />
        ) : attendance.isError ? (
          <ErrorState error={attendance.error} onRetry={() => void attendance.refetch()} compact />
        ) : !attendance.data.loginAt ? (
          <Banner
            tone="warn"
            icon="clock"
            title={t('fa03.notLoggedIn')}
            message={t('fa03.shift', {
              start: formatShiftTime(attendance.data.clocks.shiftStart),
              end: formatShiftTime(attendance.data.clocks.shiftEnd),
            })}
            testID="attendance-not-logged-in"
            action={
              <Button
                label={login.isPending ? t('fa03.loggingIn') : t('fa03.login')}
                variant="success"
                loading={login.isPending}
                onPress={() => login.mutate()}
                testID="attendance-login"
              />
            }
          />
        ) : attendance.data.logoutAt ? (
          <Banner tone="info" icon="clock" title={t('fa03.dayEndedAt', { time: formatTimeIst(attendance.data.logoutAt) })} testID="attendance-ended" />
        ) : (
          <AttendanceBar day={attendance.data} />
        )}
        {loginErrorMessage ? <Banner tone="error" message={loginErrorMessage} testID="attendance-login-error" /> : null}

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
                onPress={() => router.push(pageRoutes.todaysWork(today.data?.date, n.kind))}
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
          {(today.data?.needsYou ?? []).map((item, i, all) => (
            <NeedsRow key={item.id} item={item} last={i === all.length - 1} />
          ))}
        </Card>
      </Screen>
    </View>
  );
}

/** Logged in at …, on time or late, the status chip (tap to change) and End my day. */
function AttendanceBar({ day }: { day: AttendanceToday }) {
  const { t } = useI18n();
  const { attendance } = useEndpoints();
  const client = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [ending, setEnding] = useState(false);
  const after = (data: AttendanceToday) => {
    client.setQueryData(queryKeys.attendanceToday, data);
    void client.invalidateQueries({ queryKey: ['field-work'] });
  };
  const change = useMutation<AttendanceToday, Error, string>({ mutationFn: (status) => attendance.setStatus(status), onSuccess: after });
  const end = useMutation<AttendanceToday, Error>({ mutationFn: () => attendance.logout(), onSuccess: (d) => (after(d), setEnding(false)) });
  const status = day.status;
  return (
    <View style={styles.bar} testID="attendance-logged-in">
      <View style={styles.barTop}>
        <IconTile icon="clock" accent="green" size={34} />
        <View style={styles.flex1}>
          <Text variant="bodyStrong">{t('fa03.loggedInAt', { time: formatTimeIst(day.loginAt!) })}</Text>
          <Text variant="small" color={day.lateMinutes > 0 ? colors.tomato : colors.greenText}>
            {day.lateMinutes > 0 ? t('fa03.lateBy', { minutes: day.lateMinutes }) : t('fa03.onTime')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('today.changeStatus')}
          onPress={() => setPicking(true)}
          style={styles.statusTap}
          testID="attendance-status"
        >
          <StatusChip label={status ? statusLabel(status, t) : t('today.pickStatus')} tone="green" dot />
          <Icon name="chevron-right" size={14} color={colors.greenText} />
        </Pressable>
      </View>
      <Button label={t('today.endDay')} variant="secondary" onPress={() => setEnding(true)} testID="attendance-end" />
      {change.error || end.error ? (
        <Banner
          tone="error"
          message={change.error ? attendanceErrorText(change.error, 'today.statusFailed', t)! : attendanceErrorText(end.error, 'today.endDayFailed', t)!}
          testID="attendance-error"
        />
      ) : null}

      <Sheet open={picking} onClose={() => setPicking(false)} title={t('today.changeStatus')}>
        {status && !isPickableStatus(status) ? (
          <Text variant="muted" testID="status-automatic">{t('today.statusAutomatic', { status: statusLabel(status, t) })}</Text>
        ) : null}
        <ChoiceList
          choices={STATUS_CHOICES.map((s) => ({ value: s, label: statusLabel(s, t), ...STATUS_ICON[s] }))}
          value={isPickableStatus(status) ? status : null}
          onChange={(s) => {
            setPicking(false);
            if (s !== status) change.mutate(s);
          }}
          testID="status-choice"
        />
      </Sheet>
      <Sheet open={ending} onClose={() => setEnding(false)} title={t('today.endDayTitle')}>
        <Text variant="muted">{t('today.endDayBody')}</Text>
        <Button label={t('today.endDay')} variant="danger" loading={end.isPending} onPress={() => end.mutate()} testID="attendance-end-confirm" />
        <Button label={t('common.cancel')} variant="secondary" onPress={() => setEnding(false)} />
      </Sheet>
    </View>
  );
}

/** One item of Needs you now: what it is (in the agent's language), when, and where it opens. */
function NeedsRow({ item, last }: { item: NeedsItem; last: boolean }) {
  const { t } = useI18n();
  const look = NEEDS_LOOK[item.kind] ?? { icon: 'bell', accent: 'navy' };
  const href = needsTarget(item);
  const vacancy = item.vacancy ? (item.vacancy.headcount > 1 ? `${item.vacancy.trade} × ${item.vacancy.headcount}` : item.vacancy.trade) : null;
  const what =
    item.kind === 'interview_today' && item.interview
      ? t('needs.interview_today', { time: formatTimeIst(item.interview.startsAt), name: item.interview.candidateName })
      : item.kind === 'visit_unfinished'
        ? t(`needs.visit.${item.target.step ?? 'record_result'}` as MessageKey)
        : item.kind === 'agreement_waiting'
          ? t(item.agreement?.state === 'link_expired' ? 'needs.agreement_expired' : item.agreement?.state === 'not_sent' ? 'needs.agreement_not_sent' : 'needs.agreement_waiting')
          : item.kind === 'joining_due' && item.placement
            ? t('needs.joining_due', { name: item.placement.candidateFirstName })
            : vacancy && (item.kind === 'vacancy_awaiting_owner' || item.kind === 'vacancy_draft' || item.kind === 'ready_show_candidates')
              ? t(`needs.${item.kind}` as MessageKey, { vacancy })
              : t(`needs.${item.kind}` as MessageKey, { vacancy: '' });
  // A vacancy's trade is already in the sentence ("Waiting for the owner's code · Cook"): never twice (A8).
  const extra = item.vacancy && item.subtitle?.trim().toLowerCase() === item.vacancy.trade.trim().toLowerCase() ? null : item.subtitle;
  const dueLabel =
    item.due === 'overdue'
      ? t('needs.overdue')
      : item.due === 'today'
        ? t('date.today')
        : item.due === 'tomorrow'
          ? t('date.tomorrow')
          : item.kind === 'revisit_due' && item.revisitOn
            ? formatDateKey(item.revisitOn)
            : null;
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

/** A bottom sheet with a title. */
function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text variant="h2">{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexBasis: '48%', flexGrow: 1 },
  full: { flexBasis: '100%' },
  targets: { gap: 8, paddingTop: 4 },
  targetsHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  onBlueLabel: { fontFamily: fonts.body700, fontSize: fontSize.label, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.onBlueSoft, flex: 1 },
  onBlueStrong: { fontFamily: fonts.display700, fontSize: 18, color: colors.white, fontVariant: ['tabular-nums'] },
  bar: { gap: 10, padding: 12, borderRadius: radius.card, backgroundColor: colors.green100, borderLeftWidth: 4, borderLeftColor: colors.green },
  barTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusTap: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: touch.min, paddingLeft: 6 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: 16, paddingBottom: 32, gap: 12 },
});
