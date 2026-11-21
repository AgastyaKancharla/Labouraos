import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAfterSave } from '@/api/refresh';
import type { InterviewView } from '@/api/endpoints';
import { Banner, Button, Card, HeroCard, Screen, StatusChip, Text } from '@/components';
import { formatClock, RadioGroup } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { distanceMeters } from '@/device/location/location';
import { useLocation } from '@/device/location/useLocation';
import { useI18n } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { useSellingRoutes } from '@/navigation/useFlow';
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
 *
 * 21 Nov: Arrived also while the offer is unanswered (turning up counts as
 * accepting; the server records it), and a button to the owner's in-shop
 * decision once he has arrived.
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
  const sr = useSellingRoutes();
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const afterSave = useAfterSave();
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
    // Today's planned interviews drop the one just recorded (fix list A1 / S4).
    onSuccess: () => afterSave(queryKeys.sellingInterview(i.id)),
  });
  const now = useNow();
  const over = now >= new Date(i.slotEndsAt).getTime();
  // 21 Nov: a candidate who turns up without replying to the offer can be marked Arrived (counts as accepting).
  const offered = i.status === 'offered';
  const decided = i.status !== 'confirmed' && !offered;
  const deadline = settings.data ? formatClock(settings.data.interviewResultDeadline) : '';
  return (
    <>
      <HeroCard
        title={t('fa16.title', { business: i.business.name })}
        subtitle={[
          i.candidate.firstName,
          i.vacancy.trade,
          `${formatDayIst(i.slotStartsAt).split(' ')[0]} ${formatTimeIst(i.slotStartsAt)}`,
          i.firstWithBusiness ? t('fa16.first') : null,
        ].filter(Boolean).join(' · ')}
        emoji="🤝"
      />
      <Card>
        <KeyValue
          icon="location"
          accent={distance !== null && distance <= 200 ? 'green' : 'gold'}
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
          {offered ? <Banner tone="info" message={t('fa16.offeredHint')} testID="offered-hint" /> : null}
          <RadioGroup
            label={t('fa16.didCome', { name: i.candidate.firstName })}
            value={came}
            onChange={setCame}
            testID="came"
            options={[
              { value: 'arrived', label: t('fa16.arrived', { time: formatTimeIst(now) }) },
              ...(offered
                ? []
                : [{ value: 'no_show' as const, label: t('fa16.didntCome', { time: formatTimeIst(i.slotEndsAt) }), tone: 'bad' as const, hint: over ? undefined : t('fa16.waitTillEnd') }]),
            ]}
          />
          <Button label={t('fa16.save')} disabled={!came || (came === 'no_show' && !over)} loading={save.isPending} onPress={() => save.mutate()} testID="save" />
        </>
      )}
      <ErrorBanner error={save.error} />
      <Card title={t('fa16.after')} icon="clock" accent="cyan">
        <StepRow label={t('fa16.ownerResult', { time: deadline })} chip={i.resultRecordedAt ? t('fa16.done') : t('fa16.waiting')} tone={i.resultRecordedAt ? 'green' : 'amber'} />
        <StepRow
          label={t('fa16.candidateAsked', { name: i.candidate.firstName })}
          chip={i.candidateCheckAnswer === 'offered_yes' || i.candidateCheckAnswer === 'offered_no' ? t('fa16.done') : t('fa16.waiting')}
          tone={i.candidateCheckAnswer === 'offered_yes' || i.candidateCheckAnswer === 'offered_no' ? 'green' : 'amber'}
          last
        />
      </Card>
      {/* 21 Nov: the owner's in-shop decision (selected / not selected, by his OTP) from this screen. */}
      {i.candidateArrivedAt && !i.resultRecordedAt ? (
        <Button label={t('fa16.ownerDecision')} onPress={() => router.push(sr.owner(i.id))} testID="owner-decision" />
      ) : null}
      <Note>{t('fa16.noShowRule')}</Note>
      <Button label={t('fa16.showNext')} variant="secondary" onPress={() => router.push(sr.matches(i.business.id, i.vacancy.id))} testID="show-next" />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
