import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, Icon, IconTile, ListRow, LoadingState, Screen, SearchBar, StatusChip } from '@/components';
import { todayKeyIst } from '@/components/form';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { FieldVisits } from '@/api/endpoints';
import { formatDayIst, formatShiftTime, formatTimeIst } from '@/lib/format';
import { VerificationJobCard } from '../_visits/VerificationJobCard';
import { pageRoutes, routes, sellingRoutesFor } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { formatDateKey } from '../_visits/format';
import { DaySwitcher, DayWork, useDayWork } from '../_visits/DayWork';

/** Interviews to attend open the interview-day screen inside the Visits tab. */
const inVisits = sellingRoutesFor('/visit');
/** Rows of Today's work shown here before "See all". */
const WORK_ROWS = 8;

/**
 * FA05 — Visits, the tab's main page (redesign, 16 Nov): Visit a shop; planned
 * today (verification visits open the verification steps, interviews to
 * attend open the interview-day screen); revisits due; Today's work with
 * Today, Yesterday and a date picker; and Shops near me (the map).
 * Data: GET /field-work/visits (planned, revisits), GET /field-work/day.
 */
export default function VisitsScreen() {
  const { t } = useI18n();
  const { fieldWork } = useEndpoints();
  const q = useQuery<FieldVisits>({ queryKey: queryKeys.fieldVisits, queryFn: () => fieldWork.visits() });
  const [date, setDate] = useState(() => todayKeyIst());
  const work = useDayWork(date);

  return (
    <View style={styles.flex} testID="screen-FA05">
      <AppHeader title={t('fa05.title')} root />
      <Screen
        onRefresh={() => {
          void q.refetch();
          void work.refetch();
        }}
        refreshing={q.isRefetching}
      >
        <SearchBar onPress={() => router.push(routes.visitsSearch)} />
        <Button
          label={t('fa03.visitShop')}
          icon={<Icon name="camera" color={colors.white} />}
          onPress={() => router.push(routes.visitStart)}
          testID="fa05-visit-shop"
        />
        <Button
          label={t('fa05.shopsNearMe')}
          variant="secondary"
          icon={<Icon name="map" color={colors.cyan} />}
          onPress={() => router.push(routes.shopsNearMe)}
          testID="fa05-near-me"
        />
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <Card title={t('fa05.planned')} icon="calendar" accent="royal" testID="fa05-planned">
              {q.data.planned.length === 0 ? <EmptyState compact emoji="🗓️" message={t('fa05.noPlanned')} /> : null}
              {q.data.planned.map((p, i) => {
                // An app sign-up's visit (business_signup) is its verification visit: the same steps.
                const verify = p.purpose === 'verification' || p.purpose === 'business_signup';
                const signup = p.purpose === 'business_signup';
                // 21 Nov (M12): a verification visit is a job card with the address, owner, Call owner and Open in Maps.
                if (verify && p.job) return <VerificationJobCard key={p.assignmentId} job={p.job} testID={`fa05-planned-${p.assignmentId}`} />;
                return (
                  <ListRow
                    key={p.assignmentId}
                    title={p.business.name}
                    leading={<IconTile icon={signup ? 'user-plus' : verify ? 'shield' : 'users'} accent={signup ? 'green' : verify ? 'royal' : 'cyan'} size={34} />}
                    subtitle={
                      p.interview
                        ? `${formatDayIst(p.interview.startsAt)} ${formatTimeIst(p.interview.startsAt)} · ${p.interview.candidateName}`
                        : [
                            signup && p.requestedFor
                              ? t('fa05.ownerPicked', { when: `${formatDayIst(p.requestedFor)} ${formatTimeIst(p.requestedFor)}` })
                              : null,
                            p.business.locality,
                            p.business.code,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                    }
                    trailing={
                      <StatusChip
                        tone={signup ? 'green' : verify ? 'blue' : 'cyan'}
                        label={signup ? t('fa05.signupVisit') : verify ? t('fa05.verification') : t('fa05.attendInterview')}
                      />
                    }
                    onPress={() =>
                      verify
                        ? router.push({ pathname: routes.visitVerify, params: { businessId: p.business.id, assignmentId: p.assignmentId } })
                        : p.interview
                          ? router.push(inVisits.interviewDay(p.interview.id))
                          : router.push(pageRoutes.business(p.business.id))
                    }
                    last={i === q.data.planned.length - 1}
                    testID={`fa05-planned-${p.assignmentId}`}
                  />
                );
              })}
            </Card>

            <Card title={t('fa05.revisits')} icon="store" accent="gold" testID="fa05-revisits">
              {q.data.revisitsDue.length === 0 ? <EmptyState compact emoji="🏪" message={t('fa05.noRevisits')} /> : null}
              {q.data.revisitsDue.map((r, i) => (
                <ListRow
                  key={r.visitId}
                  title={r.name}
                  leading={<IconTile icon={r.when === 'overdue' ? 'alert' : 'clock'} accent={r.when === 'overdue' ? 'red' : 'gold'} size={34} />}
                  subtitle={
                    [
                      r.note ? t('fa05.ownerSaid', { note: r.note }) : r.locality,
                      r.revisitTime ? t('fa05.comeBackAt', { time: formatShiftTime(r.revisitTime) }) : null,
                      r.covering ? t('fa05.covering') : null,
                    ].filter(Boolean).join(' · ') || undefined
                  }
                  trailing={
                    <StatusChip
                      tone={r.when === 'overdue' ? 'tomato' : 'amber'}
                      label={r.when === 'overdue' && r.revisitOn ? t('fa05.overdueSince', { date: formatDateKey(r.revisitOn) }) : t('fa05.comeBackToday')}
                    />
                  }
                  onPress={() =>
                    router.push({
                      pathname: routes.visitStart,
                      params: r.businessId ? { businessId: r.businessId, name: r.name } : { revisitOf: r.visitId, name: r.name },
                    })
                  }
                  last={i === q.data.revisitsDue.length - 1}
                  testID={`fa05-revisit-${r.visitId}`}
                />
              ))}
            </Card>
          </>
        )}

        <Card title={t('work.title')} icon="check-circle" accent="green" testID="fa05-work">
          <DaySwitcher date={date} onDate={setDate} testID="fa05-day" />
          <DayWork date={date} limit={WORK_ROWS} onMore={() => router.push(pageRoutes.todaysWork(date))} />
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
