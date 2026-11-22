import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useI18n } from '@/i18n';
import { Button, Card, HeroCard, IconTile, ListRow, PlaceLine, ProgressBar, Screen, Text } from '@/components';
import { useAuth } from '@/auth/AuthProvider';
import { routes } from '@/navigation/routes';
import { colors, fonts } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { useAttendanceToday, useFieldHome } from '../FA03-Home/useHome';
import { DayControls, dayState } from '../_attendance/DayControls';

const FULL_DAY_SECONDS = 8 * 3600;

function hm(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * FA04 — My day. Log in / Log out and the status (the same controls as
 * Today, 17 Nov: On visit and Travelling are automatic at a shop; meetings,
 * training and breaks are picked; no picker once the day has ended),
 * production and breaks today, and the one GPS
 * point saved at check-in with its accuracy. Location is recorded only at
 * login, visits and calls — never all day.
 */
export default function CheckedInScreen() {
  const { t } = useI18n();
  const { session } = useAuth();
  const today = useAttendanceToday();
  const home = useFieldHome();
  const state = dayState(today.data);
  const checkIn = home.data?.checkIn ?? null;

  return (
    <View style={styles.flex} testID="screen-FA04">
      <AppHeader title={t('fa03.headerTitle')} subtitle={`${session?.staff.name ?? ''} · ${t(state === 'open' ? 'day.subtitle.open' : state === 'ended' ? 'day.subtitle.ended' : 'day.subtitle.notStarted')}`} />
      <Screen onRefresh={() => void today.refetch()} refreshing={today.isRefetching}>
        {/* Log in / status / Log out: the same controls as Today (17 Nov); never a status picker on a day that is not open. */}
        <DayControls testID="fa04-day" />
        {today.data?.loginAt ? (
          <>
            <HeroCard eyebrow={t('fa04.production')} emoji="⏱️">
              <Text style={styles.heroValue} testID="fa04-production">
                {t('fa04.ofHours', { done: hm(today.data.productionSeconds), total: '8h' })}
              </Text>
              {/* Half the production on a day with a half day of leave (owner decision 12 Nov). */}
              <ProgressBar value={today.data.productionSeconds / (today.data.leaveHalf ? FULL_DAY_SECONDS / 2 : FULL_DAY_SECONDS)} color={colors.cyanRaw} onBlue />
            </HeroCard>
            <Card>
              <ListRow
                title={t('fa04.breaks')}
                leading={<IconTile icon="clock" accent="orange" size={34} />}
                trailing={<Text variant="bodyStrong">{hm(today.data.breakSeconds)}</Text>}
              />
              <ListRow
                title={t('fa04.myAttendance')}
                leading={<IconTile icon="calendar" accent="royal" size={34} />}
                onPress={() => router.push(routes.myAttendance)}
                last
              />
            </Card>
          </>
        ) : null}
        <Card testID="fa04-location">
          <ListRow title={t('fa04.location')} leading={<IconTile icon="location" accent="cyan" size={34} />} trailing={checkIn ? <PlaceLine latitude={checkIn.latitude} longitude={checkIn.longitude} variant="bodyStrong" testID="fa04-place" /> : <Text variant="bodyStrong">{t('common.placeholderValue')}</Text>} />
          <ListRow
            title={t('fa04.accuracy')}
            leading={<IconTile icon="target" accent="green" size={34} />}
            trailing={<Text variant="bodyStrong">{checkIn ? t('device.location.accuracy', { meters: Math.round(checkIn.accuracyMeters) }) : t('common.placeholderValue')}</Text>}
          />
          <ListRow title={t('fa04.recorded')} leading={<IconTile icon="shield" accent="navy" size={34} />} trailing={<Text variant="small">{t('fa04.recordedValue')}</Text>} last />
        </Card>
        <Text variant="muted">{t('fa04.privacy')}</Text>
        <Button label={t('fa04.seeVisits')} onPress={() => router.push(routes.visits)} testID="fa04-see-visits" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  heroValue: { fontFamily: fonts.display700, fontSize: 24, lineHeight: 30, color: colors.white, fontVariant: ['tabular-nums'] },
});
