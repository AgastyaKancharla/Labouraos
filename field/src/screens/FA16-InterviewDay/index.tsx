import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { InterviewView } from '@/api/endpoints';
import { Banner, Button, Card, Screen, StatusChip, Text } from '@/components';
import { formatClock, RadioGroup } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { distanceMeters } from '@/device/location/location';
import { useLocation } from '@/device/location/useLocation';
import { useI18n } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner, KeyValue, Note, QueryView, StepRow, useParam, useNow, useSellingSettings, UserFacingError } from '../_selling';

/**
 * FA16 — Interview day. The attending agent's GPS at the shop (with the
 * distance from the shop's pin), then "Did he come?": Arrived (recorded with
 * GPS and the time) or Didn't come (only once the interview time is over —
 * a hit for him; show the owner the next matches on the spot). The owner
 * records the result himself by OTP by 8 PM. Needs signal (the time comes
 * from the server).
 */
export default function InterviewDayScreen() {
  const { t } = useI18n();
  const id = useParam('id');
  const { selling } = useEndpoints();
  const interview = useQuery({ queryKey: queryKeys.sellingInterview(id), queryFn: () => selling.interview(id), enabled: !!id });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa16.subtitle')} />
      <Screen testID="screen-FA16">
        <QueryView query={interview}>{(i) => <Day interview={i} />}</QueryView>
      </Screen>
    </View>
  );
}

function Day({ interview: i }: { interview: InterviewView }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const settings = useSellingSettings();
  const location = useLocation();
  const [came, setCame] = useState<'arrived' | 'no_show' | null>(i.candidateArrivedAt ? 'arrived' : null);
  const { read } = location;
  useEffect(() => {
    void read();
  }, [read]);
  const fix = location.fix;
  const distance = fix && i.business.latitude !== null && i.business.longitude !== null
    ? Math.round(distanceMeters(fix, { latitude: i.business.latitude, longitude: i.business.longitude }))
    : null;
  const save = useMutation({
    mutationFn: async () => {
      const reading = fix ?? (await read());
      if (!reading) throw new UserFacingError(t('fa16.needGps'));
      return queue.live(() =>
        selling.arrival(i.id, { arrived: came === 'arrived', latitude: reading.latitude, longitude: reading.longitude, accuracyM: reading.accuracy }),
      );
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.sellingInterview(i.id) }),
  });
  const now = useNow();
  const over = now >= new Date(i.slotEndsAt).getTime();
  const decided = i.status !== 'confirmed';
  const deadline = settings.data ? formatClock(settings.data.interviewResultDeadline) : '';
  return (
    <>
      <View>
        <Text variant="h2" style={styles.title}>{t('fa16.title', { business: i.business.name })}</Text>
        <Text variant="muted">
          {[
            i.candidate.firstName,
            i.vacancy.trade,
            `${formatDayIst(i.slotStartsAt).split(' ')[0]} ${formatTimeIst(i.slotStartsAt)}`,
            i.firstWithBusiness ? t('fa16.first') : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Card>
        <KeyValue
          label={distance !== null && distance > 200 ? t('fa16.farFromShop') : t('fa16.atShop')}
          last
          testID="gps"
          trailing={
            <StatusChip
              label={location.loading ? t('fa16.readingGps') : distance !== null ? t('fa16.gps', { meters: distance }) : location.errorKey ? t('fa16.noGps') : '—'}
              tone={distance !== null && distance <= 200 ? 'green' : 'amber'}
            />
          }
        />
        {location.errorKey ? <Text variant="small" color={colors.tomato}>{t(location.errorKey)}</Text> : null}
      </Card>
      {i.candidateArrivedAt ? (
        <Banner tone="ok" message={t('fa16.arrivedAt', { name: i.candidate.firstName, time: formatTimeIst(i.candidateArrivedAt) })} testID="arrived" />
      ) : i.status === 'no_show' ? (
        <Banner tone="warn" message={t('fa16.noShowSaved', { name: i.candidate.firstName })} testID="no-show-saved" />
      ) : decided ? null : (
        <>
          <RadioGroup
            label={t('fa16.didCome', { name: i.candidate.firstName })}
            value={came}
            onChange={setCame}
            testID="came"
            options={[
              { value: 'arrived', label: t('fa16.arrived', { time: formatTimeIst(now) }) },
              { value: 'no_show', label: t('fa16.didntCome', { time: formatTimeIst(i.slotEndsAt) }), tone: 'bad', hint: over ? undefined : t('fa16.waitTillEnd') },
            ]}
          />
          <Button label={t('fa16.save')} disabled={!came || (came === 'no_show' && !over)} loading={save.isPending} onPress={() => save.mutate()} testID="save" />
        </>
      )}
      <ErrorBanner error={save.error} />
      <Card title={t('fa16.after')}>
        <StepRow label={t('fa16.ownerResult', { time: deadline })} chip={i.resultRecordedAt ? t('fa16.done') : t('fa16.waiting')} tone={i.resultRecordedAt ? 'green' : 'amber'} />
        <StepRow
          label={t('fa16.candidateAsked', { name: i.candidate.firstName })}
          chip={i.candidateCheckAnswer === 'offered_yes' || i.candidateCheckAnswer === 'offered_no' ? t('fa16.done') : t('fa16.waiting')}
          tone={i.candidateCheckAnswer === 'offered_yes' || i.candidateCheckAnswer === 'offered_no' ? 'green' : 'amber'}
          last
        />
      </Card>
      <Note>{t('fa16.noShowRule')}</Note>
      <Button label={t('fa16.showNext')} variant="secondary" onPress={() => router.push(sellingRoutes.matches(i.business.id, i.vacancy.id))} testID="show-next" />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 17 },
});
