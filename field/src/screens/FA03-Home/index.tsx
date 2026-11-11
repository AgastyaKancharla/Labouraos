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
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { isLocationError, placementsProgress, useAttendanceLogin, useAttendanceToday, useTargetDashboard } from './useHome';

/**
 * FA03 — Home. Login and status, search, today's numbers, the four quick
 * buttons, alerts (with the "waiting to send" row), to-dos and placements
 * this month.
 *
 * Real data: attendance (GET /attendance/today, POST /attendance/login with
 * GPS), placements this month (GET /targets/dashboard), the offline queue.
 * Placeholders until their endpoints exist: the five "Today" numbers,
 * alerts and to-dos (see field/README.md, "What FA03 still needs").
 */
export default function HomeScreen() {
  const { t, tn } = useI18n();
  const { session } = useAuth();
  const today = useAttendanceToday();
  const targets = useTargetDashboard();
  const login = useAttendanceLogin();
  const queue = useOfflineQueue();

  const [openedAt] = useState(() => Date.now());
  const name = session?.staff.name ?? '';
  const subtitle = `${name} · ${formatDayIst(today.data?.clocks.now ?? openedAt)}`;
  const progress = placementsProgress(targets.data);
  const placeholder = t('common.placeholderValue');

  function refresh() {
    void today.refetch();
    void targets.refetch();
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
              { key: 'shops', value: placeholder, label: t('fa03.shopsVisited') },
              { key: 'onboarded', value: placeholder, label: t('fa03.onboarded') },
              { key: 'vacancies', value: placeholder, label: t('fa03.vacancies') },
              { key: 'shown', value: placeholder, label: t('fa03.shown') },
              { key: 'interviews', value: placeholder, label: t('fa03.interviews') },
            ]}
          />
          <Text variant="tiny" align="center" style={styles.note} testID="today-placeholder-note">
            {t('common.notAvailableYet')}
          </Text>
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
          ) : (
            <EmptyState compact message={t('fa03.noAlerts')} />
          )}
        </Card>

        <Card title={t('fa03.todo')}>
          <EmptyState compact message={t('fa03.noTodos')} />
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
