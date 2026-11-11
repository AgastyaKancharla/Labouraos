import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { BookingContext } from '@/api/endpoints';
import { Button, Card, Screen, Text } from '@/components';
import { Checkbox, DateField, formatClock, SelectField, TimeField, todayKeyIst } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner, Note, QueryView, useParam, useSellingSettings } from '../_selling';

type InterviewType = 'at_shop' | 'walk_in' | 'phone';

/**
 * FA15g — Book interview. Date and time from a calendar and a clock (never
 * typed); type: at the shop, walk-in window, or a phone interview where
 * Laboura calls both at the set time (only when the calling company's 3-way
 * calls are on). "I will attend" — ticked and locked for a first interview
 * with the business. Booking sends the offer, so it needs signal. From the
 * owner's "Wants to meet" (from=interview) the in-shop talk ends first.
 */
export default function BookInterviewScreen() {
  const { t } = useI18n();
  const vacancyId = useParam('vacancyId');
  const jobSeekerId = useParam('jobSeekerId');
  const { selling } = useEndpoints();
  const ctx = useQuery({
    queryKey: queryKeys.sellingBooking(vacancyId, jobSeekerId),
    queryFn: () => selling.booking(vacancyId, jobSeekerId),
    enabled: !!vacancyId && !!jobSeekerId,
  });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa15g.subtitle')} />
      <Screen testID="screen-FA15g">
        <QueryView query={ctx}>{(c) => <Book ctx={c} jobSeekerId={jobSeekerId} />}</QueryView>
      </Screen>
    </View>
  );
}

function Book({ ctx, jobSeekerId }: { ctx: BookingContext; jobSeekerId: string }) {
  const { t } = useI18n();
  const from = useParam('from');
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const settings = useSellingSettings();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [type, setType] = useState<InterviewType>('at_shop');
  const [attend, setAttend] = useState(ctx.attendanceRequired);
  const willAttend = ctx.attendanceRequired || attend;
  const book = useMutation({
    mutationFn: () => {
      const body = { date, time: type === 'walk_in' ? ctx.walkInStart : time, type, agentWillAttend: willAttend };
      return queue.live(() => (from ? selling.meet(from, body) : selling.book({ ...body, vacancyId: ctx.vacancyId, jobSeekerId })));
    },
    onSuccess: (r) => router.replace(sellingRoutes.booked(r.interviewId)),
  });
  const hours = settings.data;
  const ready = !!date && (type === 'walk_in' || !!time);
  return (
    <>
      <View>
        <Text variant="h2" style={styles.title}>{t('fa15g.title')}</Text>
        <Text variant="muted">{t('fa15g.who', { name: ctx.candidateFirstName, business: ctx.businessName, trade: ctx.trade })}</Text>
      </View>
      <Card>
        <View style={styles.gap}>
          <DateField label={t('fa15g.date')} required value={date} onChange={setDate} min={todayKeyIst()} testID="date" />
          {type !== 'walk_in' ? (
            <TimeField
              label={t('fa15g.time')}
              required
              value={time}
              onChange={setTime}
              from={hours?.callingHoursStart ?? '09:00'}
              to={hours?.callingHoursEnd ?? '21:00'}
              testID="time"
            />
          ) : null}
          <SelectField
            label={t('fa15g.type')}
            required
            value={type}
            onChange={setType}
            testID="type"
            choices={[
              { value: 'at_shop', label: t('fa15g.atShop') },
              { value: 'walk_in', label: t('fa15g.walkIn', { start: formatClock(ctx.walkInStart), end: formatClock(ctx.walkInEnd) }) },
              ...(ctx.threeWayCalls ? [{ value: 'phone' as const, label: t('fa15g.phone') }] : []),
            ]}
            hint={ctx.threeWayCalls ? undefined : t('fa15g.phoneOff')}
          />
          <Checkbox
            label={ctx.attendanceRequired ? t('fa15g.attendFirst') : t('fa15g.attend')}
            checked={willAttend}
            disabled={ctx.attendanceRequired}
            onChange={setAttend}
            testID="attend"
          />
        </View>
      </Card>
      <Button label={t('fa15g.book')} disabled={!ready} loading={book.isPending} onPress={() => book.mutate()} testID="book" />
      <ErrorBanner error={book.error} />
      <Note>{t('fa15g.note')}</Note>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  gap: { gap: 12 },
  title: { fontSize: 17 },
});
