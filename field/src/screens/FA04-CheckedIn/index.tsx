import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, ErrorState, ListRow, LoadingState, ProgressBar, Screen, Text } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import type { AttendanceToday } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthProvider';
import { formatCoordinates } from '@/device/location/location';
import { formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { useAttendanceToday, useFieldHome } from '../FA03-Home/useHome';
import { SelectField } from '../_visits/SelectField';

/** Statuses a field agent picks here. On visit is set automatically at a shop; Travelling ends it. */
const PICKABLE = ['travelling', 'on_visit', 'team_meeting', 'training', 'short_break', 'lunch'] as const;
const FULL_DAY_SECONDS = 8 * 3600;

function hm(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * FA04 — Checked in. Login time and lateness, the status dropdown (On visit
 * is automatic at a shop; picking Travelling ends it; meetings, training and
 * breaks are picked here), production and breaks today, and the one GPS
 * point saved at check-in with its accuracy. Location is recorded only at
 * login, visits and calls — never all day.
 */
export default function CheckedInScreen() {
  const { t } = useI18n();
  const { session } = useAuth();
  const { attendance, visits } = useEndpoints();
  const client = useQueryClient();
  const today = useAttendanceToday();
  const home = useFieldHome();
  const change = useMutation<AttendanceToday, Error, string>({
    mutationFn: (status) => (status === 'travelling' ? visits.businessCheckOut().then(() => attendance.today()) : attendance.setStatus(status)),
    onSuccess: (data) => client.setQueryData(queryKeys.attendanceToday, data),
  });

  const labels: Record<(typeof PICKABLE)[number], string> = {
    travelling: t('status.travelling'),
    on_visit: t('fa04.onVisitAuto'),
    team_meeting: t('status.team_meeting'),
    training: t('status.training'),
    short_break: t('fa04.shortBreak'),
    lunch: t('fa04.lunch'),
  };
  const checkIn = home.data?.checkIn ?? null;

  return (
    <View style={styles.flex} testID="screen-FA04">
      <AppHeader title={t('fa03.headerTitle')} subtitle={`${session?.staff.name ?? ''} · ${t('fa04.checkedIn')}`} />
      <Screen onRefresh={() => void today.refetch()} refreshing={today.isRefetching}>
        {today.isPending ? (
          <LoadingState />
        ) : today.isError ? (
          <ErrorState error={today.error} onRetry={() => void today.refetch()} />
        ) : !today.data.loginAt ? (
          <Banner tone="warn" title={t('fa03.notLoggedIn')} message={t('fa04.loginOnHome')} action={<Button label={t('tabs.home')} onPress={() => router.replace(routes.home)} />} />
        ) : (
          <>
            <Banner
              tone="ok"
              title={`${t('fa03.loggedInAt', { time: formatTimeIst(today.data.loginAt) })} · ${
                today.data.lateMinutes > 0 ? t('fa03.lateBy', { minutes: today.data.lateMinutes }) : t('fa03.onTime')
              }`}
              testID="fa04-logged-in"
            />
            <Card>
              <SelectField
                label={t('fa03.myStatus')}
                value={(PICKABLE as readonly string[]).includes(today.data.status ?? '') ? (today.data.status as (typeof PICKABLE)[number]) : null}
                placeholder={today.data.status ? t(`status.${today.data.status}` as 'status.available') : t('form.choose')}
                choices={PICKABLE.map((s) => ({ value: s, label: labels[s], disabled: s === 'on_visit' }))}
                onChange={(s) => {
                  if (s !== 'on_visit') change.mutate(s);
                }}
                testID="fa04-status"
              />
              {change.error ? <Text variant="small" color={colors.tomato}>{isApiError(change.error) ? change.error.message : t('common.error')}</Text> : null}
            </Card>
            <Card>
              <ListRow
                title={t('fa04.production')}
                trailing={
                  <Text variant="bodyStrong" testID="fa04-production">
                    {t('fa04.ofHours', { done: hm(today.data.productionSeconds), total: '8h' })}
                  </Text>
                }
              />
              {/* Half the production on a day with a half day of leave (owner decision 12 Nov). */}
              <ProgressBar value={today.data.productionSeconds / (today.data.leaveHalf ? FULL_DAY_SECONDS / 2 : FULL_DAY_SECONDS)} />
              <View style={styles.gap} />
              <ListRow title={t('fa04.breaks')} trailing={<Text variant="bodyStrong">{hm(today.data.breakSeconds)}</Text>} />
              <ListRow title={t('fa04.myAttendance')} onPress={() => router.push(routes.myAttendance)} last />
            </Card>
          </>
        )}
        <Card testID="fa04-location">
          <ListRow title={t('fa04.location')} trailing={<Text variant="bodyStrong">{checkIn ? formatCoordinates(checkIn) : t('common.placeholderValue')}</Text>} />
          <ListRow
            title={t('fa04.accuracy')}
            trailing={<Text variant="bodyStrong">{checkIn ? t('device.location.accuracy', { meters: Math.round(checkIn.accuracyMeters) }) : t('common.placeholderValue')}</Text>}
          />
          <ListRow title={t('fa04.recorded')} trailing={<Text variant="small">{t('fa04.recordedValue')}</Text>} last />
        </Card>
        <Text variant="muted">{t('fa04.privacy')}</Text>
        <Button label={t('fa04.seeVisits')} onPress={() => router.push(routes.visits)} testID="fa04-see-visits" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  gap: { height: 8 },
});
