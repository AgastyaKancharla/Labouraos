import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, Icon, ListRow, LoadingState, ProgressBar, Screen, SearchBar, StatStrip, StatusChip, Text } from '@/components';
import { useAuth } from '@/auth/AuthProvider';
import { useOfflineQueue } from '@/device/offline-queue';
import { LOCATION_ERROR_KEYS } from '@/device/location/useLocation';
import { isApiError } from '@/api/errors';
import { formatDayIst, formatShiftTime, formatTimeIst } from '@/lib/format';
import { routes, sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { isLocationError, placementsProgress, useAttendanceLogin, useAttendanceToday, useFieldHome, useTargetDashboard } from './useHome';
import type { HomeAlert, HomeTodo } from '@/api/endpoints';
import { formatDateKey } from '../_visits/format';

/**
 * FA03 — Home. Login and status, search, today's numbers, the four quick
 * buttons, alerts (with the "waiting to send" row), to-dos and placements
 * this month.
 *
 * Data: attendance (GET /attendance/today, POST /attendance/login with GPS,
 * then the check-in point), today's five numbers, alerts and to-dos
 * (GET /field-work/home), placements this month (GET /targets/dashboard),
 * and the offline queue's "waiting to send" row.
 */
export default function HomeScreen() {
  const { t, tn } = useI18n();
  const { session } = useAuth();
  const today = useAttendanceToday();
  const targets = useTargetDashboard();
  const home = useFieldHome();
  const login = useAttendanceLogin();
  const queue = useOfflineQueue();

  const [openedAt] = useState(() => Date.now());
  const name = session?.staff.name ?? '';
  const subtitle = `${name} · ${formatDayIst(today.data?.clocks.now ?? openedAt)}`;
  const progress = placementsProgress(targets.data);
  const placeholder = t('common.placeholderValue');
  const n = (value: number | undefined) => (value === undefined ? placeholder : String(value));
  const counts = home.data?.today;

  function refresh() {
    void today.refetch();
    void targets.refetch();
    void home.refetch();
    void queue.flush();
  }

  const loginErrorMessage = login.error
    ? isLocationError(login.error)
      ? `${t('fa03.loginNeedsLocation')} ${t(LOCATION_ERROR_KEYS[login.error.code])}`
      : isApiError(login.error) && !login.error.isNetworkError
        ? login.error.message
        : t('common.networkError')
    : null;

  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={subtitle} />
      <Screen onRefresh={refresh} refreshing={today.isRefetching} testID="screen-FA03">
        {!queue.online ? <Banner tone="info" message={t('common.offline')} testID="offline-banner" /> : null}

        {/* Attendance: Login button, or logged-in time and status */}
        {today.isPending ? (
          <LoadingState compact />
        ) : today.isError ? (
          <ErrorState error={today.error} onRetry={() => void today.refetch()} compact />
        ) : !today.data.loginAt ? (
          <Banner
            tone="warn"
            title={t('fa03.notLoggedIn')}
            message={t('fa03.shift', {
              start: formatShiftTime(today.data.clocks.shiftStart),
              end: formatShiftTime(today.data.clocks.shiftEnd),
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
        ) : today.data.logoutAt ? (
          <Banner tone="info" title={t('fa03.dayEndedAt', { time: formatTimeIst(today.data.logoutAt) })} testID="attendance-ended" />
        ) : (
          <Banner
            tone="ok"
            title={`${t('fa03.loggedInAt', { time: formatTimeIst(today.data.loginAt) })} · ${
              today.data.lateMinutes > 0 ? t('fa03.lateBy', { minutes: today.data.lateMinutes }) : t('fa03.onTime')
            }`}
            testID="attendance-logged-in"
            action={
              today.data.status ? (
                <StatusChip label={statusLabel(today.data.status, t)} tone="green" dot />
              ) : undefined
            }
          />
        )}
        {loginErrorMessage ? <Banner tone="error" message={loginErrorMessage} testID="attendance-login-error" /> : null}

        <SearchBar onPress={() => router.push(routes.search)} />

        <Card title={t('fa03.today')} compact>
          <StatStrip
            items={[
              { key: 'shops', value: n(counts?.shopsVisited), label: t('fa03.shopsVisited') },
              { key: 'onboarded', value: n(counts?.onboarded), label: t('fa03.onboarded') },
              { key: 'vacancies', value: n(counts?.vacanciesAdded), label: t('fa03.vacancies') },
              { key: 'shown', value: n(counts?.candidatesShown), label: t('fa03.shown') },
              { key: 'interviews', value: n(counts?.interviewsBooked), label: t('fa03.interviews') },
            ]}
          />
          {home.isError ? <ErrorState error={home.error} onRetry={() => void home.refetch()} compact /> : null}
        </Card>

        <View style={styles.grid}>
          <Button
            label={t('fa03.visitShop')}
            icon={<Icon name="camera" color={colors.white} />}
            style={styles.cell}
            onPress={() => router.push(routes.visitStart)}
            testID="quick-visit"
          />
          <Button label={t('fa03.addJobSeeker')} variant="secondary" style={styles.cell} onPress={() => router.push(routes.jobSeekerNew)} testID="quick-job-seeker" />
          <Button label={t('fa03.addVacancy')} variant="secondary" style={styles.cell} onPress={() => router.push(routes.vacancyNew)} testID="quick-vacancy" />
          <Button label={t('fa03.feeCalculator')} variant="secondary" style={styles.cell} onPress={() => router.push(routes.feeCalculator)} testID="quick-fee" />
        </View>

        <Card title={t('fa03.alerts')}>
          {(home.data?.alerts ?? []).map((alert, i) => (
            <AlertRow key={`${alert.kind}-${alert.business.id}-${i}`} alert={alert} last={i === (home.data?.alerts.length ?? 0) - 1 && queue.summary.total === 0} />
          ))}
          {queue.summary.total > 0 ? (
            <ListRow
              title={queue.summary.failed > 0 ? t('fa03.waitingToSendFailed') : t('fa03.waitingToSend')}
              trailing={
                <StatusChip
                  tone={queue.summary.failed > 0 ? 'tomato' : 'amber'}
                  label={
                    queue.summary.sending
                      ? t('queue.sending')
                      : queue.summary.photos > 0
                        ? tn('queue.photos', queue.summary.photos)
                        : tn('queue.items', queue.summary.forms)
                  }
                />
              }
              onPress={() => void queue.flush()}
              last
              testID="queue-row"
            />
          ) : (home.data?.alerts.length ?? 0) === 0 ? (
            <EmptyState compact message={t('fa03.noAlerts')} />
          ) : null}
        </Card>

        <Card title={t('fa03.todo')} testID="todo-card">
          {(home.data?.todos ?? []).length === 0 ? <EmptyState compact message={t('fa03.noTodos')} /> : null}
          {(home.data?.todos ?? []).map((todo, i) => (
            <TodoRow key={`${todo.kind}-${i}`} todo={todo} last={i === (home.data?.todos.length ?? 0) - 1} />
          ))}
        </Card>

        {progress ? (
          <Card testID="placements-card">
            <Text variant="label">{t('fa03.placementsThisMonth')}</Text>
            <View style={styles.statRow}>
              <Text variant="stat" style={styles.big}>
                {progress.achieved}
              </Text>
              <Text variant="muted">{progress.target !== null ? ` / ${progress.target}` : ` · ${t('fa03.noTarget')}`}</Text>
            </View>
            <ProgressBar value={progress.ratio} />
          </Card>
        ) : null}
      </Screen>
    </View>
  );
}

function AlertRow({ alert, last }: { alert: HomeAlert; last: boolean }) {
  const { t } = useI18n();
  if (alert.kind === 'agreement_signed') {
    return (
      <ListRow
        title={t('fa03.alertSigned', { name: alert.business.name })}
        trailing={alert.canShowCandidates ? <StatusChip tone="green" label={t('fa03.showCandidates')} /> : <StatusChip tone="green" label={t('fa03.signed')} />}
        onPress={() =>
          alert.canShowCandidates
            ? router.push(sellingRoutes.matches(alert.business.id))
            : router.push(`${routes.business}/${alert.business.id}`)
        }
        last={last}
        testID={`alert-signed-${alert.business.id}`}
      />
    );
  }
  const resultKey = alert.result === 'selected' ? 'result.selected' : alert.result === 'no_show' ? 'result.no_show' : 'result.not_selected';
  return (
    <ListRow
      title={t('fa03.alertResult', { name: alert.business.name })}
      trailing={<StatusChip tone={alert.result === 'selected' ? 'blue' : 'neutral'} label={t(resultKey)} />}
      onPress={() => router.push(`${routes.business}/${alert.business.id}`)}
      last={last}
      testID={`alert-result-${alert.interviewId}`}
    />
  );
}

function TodoRow({ todo, last }: { todo: HomeTodo; last: boolean }) {
  const { t } = useI18n();
  const whenLabel = todo.when === 'today' ? t('date.today') : todo.when === 'tomorrow' ? t('date.tomorrow') : t('fa03.overdue', { date: formatDateKey(todo.due) });
  const chip = <StatusChip tone={todo.when === 'overdue' ? 'tomato' : todo.when === 'today' ? 'amber' : 'neutral'} label={whenLabel} />;
  if (todo.kind === 'revisit') {
    return (
      <ListRow
        title={t('fa03.todoRevisit', { name: todo.name })}
        subtitle={todo.outcome === 'owner_not_there' ? t('fa03.todoOwnerAway') : t('fa03.todoComeBack')}
        trailing={chip}
        onPress={() =>
          router.push({ pathname: routes.visitStart, params: todo.businessId ? { businessId: todo.businessId, name: todo.name } : { revisitOf: todo.visitId, name: todo.name } })
        }
        last={last}
        testID={`todo-revisit-${todo.visitId}`}
      />
    );
  }
  if (todo.kind === 'joining') {
    return (
      <ListRow
        title={t('fa03.todoJoining', { candidate: todo.candidateFirstName, name: todo.name })}
        trailing={chip}
        onPress={() => router.push(`${routes.business}/${todo.businessId}`)}
        last={last}
        testID={`todo-joining-${todo.placementId}`}
      />
    );
  }
  const title =
    todo.taskKind === 'placement_check_in_day_7'
      ? t('fa03.todoDay7', { name: todo.name })
      : todo.taskKind === 'placement_check_in_day_30'
        ? t('fa03.todoDay30', { name: todo.name })
        : t('fa03.todoFollowUp', { name: todo.name });
  return <ListRow title={title} trailing={chip} last={last} testID={`todo-check-${todo.taskId}`} />;
}

const STATUS_KEYS = {
  available: 'status.available',
  on_call: 'status.on_call',
  after_call_notes: 'status.after_call_notes',
  on_visit: 'status.on_visit',
  travelling: 'status.travelling',
  team_meeting: 'status.team_meeting',
  training: 'status.training',
  one_to_one: 'status.one_to_one',
  system_problem: 'status.system_problem',
  short_break: 'status.short_break',
  lunch: 'status.lunch',
  idle: 'status.idle',
} as const;

/** Status label in the agent's language; an unknown status shows as sent by the server. */
function statusLabel(status: string, t: (key: (typeof STATUS_KEYS)[keyof typeof STATUS_KEYS]) => string): string {
  const key = STATUS_KEYS[status as keyof typeof STATUS_KEYS];
  return key ? t(key) : status;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexBasis: '48%', flexGrow: 1 },
  note: { marginTop: 8 },
  statRow: { flexDirection: 'row', alignItems: 'baseline', marginVertical: 6 },
  big: { fontSize: 22 },
});
