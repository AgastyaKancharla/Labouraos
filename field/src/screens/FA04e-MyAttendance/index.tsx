import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { AttendanceDayRow, MyRequest } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Button, Card, EmptyState, ErrorState, ListRow, LoadingState, Screen, StatusChip, Text } from '@/components';
import { todayKeyIst } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors, fonts, radius, touch } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { useNow } from '../_selling';
import { formatDateKey } from '../_visits/format';
import {
  FULL_DAY_SECONDS,
  dateRange,
  dayChip,
  expectedDays,
  hhmmIst,
  hm,
  lastDayOf,
  requestChip,
  shiftMonth,
  shortSpan,
} from './format';

/** How many months back the agent can look (the current one and the five before it). */
const MONTHS_BACK = 5;

/**
 * FA04e — My attendance (CA14e-MyAttendance adapted to the phone; there is no
 * field design). The agent's own month: production against what was needed,
 * make-up owed, leave left, his leave and correction requests and where they
 * are, and every day with what it counts as. From here he requests leave
 * (FA04f) or a correction (FA04h) and opens his payslips (FA04g). The server
 * always reads the signed-in person; he can never edit his own times.
 */
export default function MyAttendanceScreen() {
  const { t } = useI18n();
  const { session } = useAuth();
  const { myAttendance } = useEndpoints();
  const now = useNow(60_000);
  const current = todayKeyIst(now).slice(0, 7);
  const [month, setMonth] = useState(current);
  const summary = useQuery({ queryKey: queryKeys.myMonth(month), queryFn: () => myAttendance.month(month) });
  const balance = useQuery({ queryKey: queryKeys.leaveBalance, queryFn: () => myAttendance.balance() });
  const requests = useQuery({ queryKey: queryKeys.myRequests, queryFn: () => myAttendance.requests() });
  const monthNumber = Number(month.slice(5, 7));
  const monthName = t(`month.${monthNumber}` as 'month.1');
  const oldest = shiftMonth(current, -MONTHS_BACK);

  const refresh = () => {
    void summary.refetch();
    void balance.refetch();
    void requests.refetch();
  };

  return (
    <View style={styles.flex} testID="screen-FA04e">
      <AppHeader title={t('fa04e.title')} subtitle={session?.staff.name} />
      <Screen onRefresh={refresh} refreshing={summary.isRefetching}>
        <View style={styles.monthRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('form.prevMonth')}
            disabled={month <= oldest}
            onPress={() => setMonth(shiftMonth(month, -1))}
            style={[styles.monthNav, month <= oldest && styles.off]}
            testID="fa04e-prev"
          >
            <Text style={styles.monthNavText}>‹</Text>
          </Pressable>
          <Text variant="h1" style={styles.monthTitle} testID="fa04e-month" accessibilityRole="header">
            {t('fa04e.monthTitle', { month: monthName, year: month.slice(0, 4) })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('form.nextMonth')}
            disabled={month >= current}
            onPress={() => setMonth(shiftMonth(month, 1))}
            style={[styles.monthNav, month >= current && styles.off]}
            testID="fa04e-next"
          >
            <Text style={styles.monthNavText}>›</Text>
          </Pressable>
        </View>

        <Button label={t('fa04e.requestLeave')} onPress={() => router.push(routes.myLeave)} testID="fa04e-leave" />
        <View style={styles.buttons}>
          <Button
            label={t('fa04e.requestCorrection')}
            variant="secondary"
            style={styles.half}
            onPress={() => router.push(routes.myCorrection)}
            testID="fa04e-correction"
          />
          <Button label={t('fa04e.payslips')} variant="secondary" style={styles.half} onPress={() => router.push(routes.myPayslips)} testID="fa04e-payslips" />
        </View>

        {summary.isPending ? (
          <LoadingState />
        ) : summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        ) : (
          <>
            <Card testID="fa04e-production">
              <Text variant="label">{t('fa04e.production')}</Text>
              <Text style={styles.big}>{hm(summary.data.productionSeconds)}</Text>
              <Text variant="muted">
                {t('fa04e.neededSoFar', {
                  needed: hm(expectedDays(summary.data.days, todayKeyIst()) * FULL_DAY_SECONDS),
                  days: expectedDays(summary.data.days, todayKeyIst()),
                })}
              </Text>
            </Card>
            <Card testID="fa04e-makeup">
              <Text variant="label">{t('fa04e.makeUpOwed')}</Text>
              <Text style={[styles.big, summary.data.deductibleShortfallSeconds > 0 && styles.owed]}>{hm(summary.data.deductibleShortfallSeconds)}</Text>
              <Text variant="muted">
                {t('fa04e.makeUpLine', {
                  short: shortSpan(summary.data.shortfallSeconds),
                  madeUp: shortSpan(summary.data.makeUpSeconds),
                  date: formatDateKey(lastDayOf(month)),
                })}
              </Text>
            </Card>
          </>
        )}

        <Card testID="fa04e-leave-left">
          <Text variant="label">{t('fa04e.leaveLeft')}</Text>
          {balance.isPending ? (
            <LoadingState compact />
          ) : balance.isError ? (
            <ErrorState compact error={balance.error} onRetry={() => void balance.refetch()} />
          ) : (
            <>
              <Text style={styles.big}>{t('fa04e.left', { count: balance.data.casual.left + balance.data.emergency.left })}</Text>
              <Text variant="muted">
                {t('fa04e.leaveSplit', { planned: balance.data.casual.left, emergency: balance.data.emergency.left })}
              </Text>
              {summary.data ? (
                <Text variant="muted">
                  {t('fa04e.usedThisMonth', {
                    planned: summary.data.paidLeaveDays.casual,
                    emergency: summary.data.paidLeaveDays.emergency,
                    unpaid: summary.data.unpaidLeaveDays,
                  })}
                </Text>
              ) : null}
              <Text variant="muted">{t('fa04e.carryForward')}</Text>
            </>
          )}
        </Card>

        <Card title={t('fa04e.myRequests')} testID="fa04e-requests">
          {requests.isPending ? (
            <LoadingState compact />
          ) : requests.isError ? (
            <ErrorState compact error={requests.error} onRetry={() => void requests.refetch()} />
          ) : requests.data.length === 0 ? (
            <Text variant="muted">{t('fa04e.noRequests')}</Text>
          ) : (
            requests.data.slice(0, 10).map((r, i, list) => <RequestRow key={`${r.kind}-${r.id}`} request={r} last={i === list.length - 1} />)
          )}
        </Card>

        {summary.data ? (
          <Card title={t('fa04e.days')} testID="fa04e-days">
            {summary.data.days.length === 0 ? (
              <EmptyState compact title={t('fa04e.noDays')} />
            ) : (
              [...summary.data.days]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((d, i, list) => <DayRow key={d.id} day={d} last={i === list.length - 1} />)
            )}
          </Card>
        ) : null}

        <Banner tone="warn" message={t('fa04e.rules')} testID="fa04e-rules" />
      </Screen>
    </View>
  );
}

function RequestRow({ request: r, last }: { request: MyRequest; last: boolean }) {
  const { t } = useI18n();
  const chip = requestChip(r);
  const title =
    r.kind === 'leave'
      ? `${r.leaveKind === 'emergency' ? t('fa04e.req.emergency') : t('fa04e.req.planned')} · ${dateRange(r.fromDate ?? '', r.toDate ?? '')}`
      : `${t('fa04e.req.correction')} · ${formatDateKey(r.date ?? '')}, ${hhmmIst(r.startAt)}–${hhmmIst(r.endAt)}`;
  const note = r.status !== 'pending' && r.decided?.reason && r.decided.reason !== 'Approved' ? r.decided.reason : undefined;
  return (
    <ListRow
      title={title}
      subtitle={note}
      trailing={<StatusChip label={t(chip.key, chip.params)} tone={chip.tone} />}
      last={last}
      testID={`fa04e-request-${r.id}`}
    />
  );
}

function DayRow({ day, last }: { day: AttendanceDayRow; last: boolean }) {
  const { t } = useI18n();
  const { main, extras } = dayChip(day);
  const times = day.loginAt ? `${formatTimeIst(day.loginAt)} – ${day.logoutAt ? formatTimeIst(day.logoutAt) : '…'}` : t('common.placeholderValue');
  const production = day.dayType === 'open' ? t('fa04e.inProgress') : day.loginAt ? hm(day.productionSeconds) : '';
  return (
    <View style={[styles.day, !last && styles.dayLine]} testID={`fa04e-day-${day.date}`}>
      <View style={styles.dayText}>
        <Text variant="bodyStrong">{formatDateKey(day.date)}</Text>
        <Text variant="muted">{[times, production].filter(Boolean).join(' · ')}</Text>
      </View>
      <View style={styles.chips}>
        <StatusChip label={t(main.key, main.params)} tone={main.tone} />
        {extras.map((c) => (
          <StatusChip key={c.key} label={t(c.key, c.params)} tone={c.tone} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monthTitle: { flex: 1, textAlign: 'center', fontSize: 19 },
  monthNav: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavText: { fontSize: 22, color: colors.blue, fontFamily: fonts.body700 },
  off: { opacity: 0.4 },
  buttons: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  big: { fontFamily: fonts.display700, fontSize: 22, color: colors.ink, marginTop: 6, marginBottom: 2 },
  owed: { color: colors.tomato },
  day: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  dayLine: { borderBottomWidth: 1, borderBottomColor: colors.border },
  dayText: { flex: 1, gap: 2 },
  chips: { alignItems: 'flex-end', gap: 4, maxWidth: '50%' },
});
