import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { CandidateCard } from '@/api/endpoints';
import { Banner, Button, Card, HeroCard, Icon, Screen, StatusChip, Text } from '@/components';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { formatDayIst } from '@/lib/format';
import { sellingRoutes } from '@/navigation/routes';
import { colors, fonts } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { Avatar, formatRupees, KeyValue, Note, QueryView, SHIFT_KEYS, useParam } from '../_selling';

/**
 * FA15d — Candidate card: what the owner sees about a candidate. First name,
 * age, trade and years, JS- ID, distance and area, expected salary,
 * languages, shift, available from, last job, ID verified, why he matches and
 * the owner's heart. Never: phone number, last name, exact address, date of birth.
 */
export default function CandidateScreen() {
  const { t } = useI18n();
  const jobSeekerId = useParam('jobSeekerId');
  const vacancyId = useParam('vacancyId');
  const { selling } = useEndpoints();
  const card = useQuery({
    queryKey: queryKeys.sellingCandidate(jobSeekerId, vacancyId),
    queryFn: () => selling.candidate(jobSeekerId, vacancyId),
    enabled: !!jobSeekerId && !!vacancyId,
  });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa15d.subtitle')} />
      <Screen testID="screen-FA15d">
        <QueryView query={card}>{(c) => <Body card={c} vacancyId={vacancyId} />}</QueryView>
      </Screen>
    </View>
  );
}

function Body({ card: c, vacancyId }: { card: CandidateCard; vacancyId: string }) {
  const { t } = useI18n();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const like = useMutation({
    mutationFn: () =>
      queue.submit(t('fa15b.likeQueued', { name: c.firstName }), {
        method: 'POST',
        path: `/field-selling/vacancies/${encodeURIComponent(vacancyId)}/favourites/${encodeURIComponent(c.jobSeekerId)}`,
        json: { liked: !c.liked },
      }),
    onMutate: () => {
      client.setQueryData<CandidateCard>(queryKeys.sellingCandidate(c.jobSeekerId, vacancyId), (old) => (old ? { ...old, liked: !old.liked } : old));
      void client.invalidateQueries({ queryKey: ['selling', 'matches', vacancyId] });
    },
  });
  const reasons = [
    t('fa15d.reasonTrade'),
    t('fa15d.reasonSalary'),
    c.distanceKm !== null ? t('fa15d.reasonDistance', { km: c.distanceKm }) : null,
    c.guaranteeDay !== null ? t('fa15d.reasonDay', { day: c.guaranteeDay, days: c.guaranteeDays }) : null,
  ].filter(Boolean);
  return (
    <>
      <HeroCard>
        <View style={styles.head}>
          <Avatar name={c.firstName} size={56} />
          <View style={styles.flexBody}>
            <Text style={styles.name}>{c.age !== null ? `${c.firstName}, ${c.age}` : c.firstName}</Text>
            <Text style={styles.sub}>
              {[c.trade, c.yearsExperience !== null ? t('fa15d.years', { years: c.yearsExperience }) : null, c.code].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      </HeroCard>
      {!c.suitable ? <Banner tone="warn" message={t('fa15d.notSuitableNow')} testID="not-suitable" /> : null}
      <Card>
        <KeyValue icon="location" accent="cyan" label={t('fa15d.distance')} value={[c.distanceKm !== null ? `${c.distanceKm} km` : null, c.locality].filter(Boolean).join(' · ')} />
        <KeyValue
          icon="rupee"
          accent="gold"
          label={t('fa15d.expectedSalary')}
          value={t('fa15d.perMonth', { min: formatRupees(c.expectedSalary.minPaise), max: formatRupees(c.expectedSalary.maxPaise).replace('₹', '') })}
        />
        <KeyValue icon="chat" accent="royal" label={t('fa15d.speaks')} value={c.languages.join(', ') || '—'} />
        <KeyValue icon="clock" accent="navy" label={t('fa15d.shift')} value={c.shift && SHIFT_KEYS[c.shift] ? t(SHIFT_KEYS[c.shift]) : '—'} />
        <KeyValue icon="calendar" accent="green" label={t('fa15d.availableFrom')} value={c.availableNow || !c.availableFrom ? t('fa15d.immediately') : formatDayIst(c.availableFrom)} />
        <KeyValue icon="briefcase" accent="orange" label={t('fa15d.lastJob')} value={[c.lastRole, c.lastEmployer].filter(Boolean).join(' · ') || '—'} />
        <KeyValue
          icon="id-card"
          accent={c.idVerified ? 'green' : 'navy'}
          label={t('fa15d.id')}
          last
          trailing={<StatusChip tone={c.idVerified ? 'green' : 'neutral'} label={c.idVerified ? t('fa15d.verified') : t('fa15d.notVerified')} />}
        />
      </Card>
      <Banner tone="ok" icon="star" message={t('fa15d.why', { reasons: reasons.join(', ') })} testID="why" />
      <View style={styles.actions}>
        <Button
          label={c.liked ? t('fa15d.ownerLikes') : t('fa15d.markLiked')}
          variant={c.liked ? 'danger' : 'secondary'}
          style={styles.action}
          onPress={() => like.mutate()}
          testID="like"
        />
        <Button
          label={t('fa15d.callToConfirm')}
          icon={<Icon name="phone" color={colors.white} />}
          style={styles.action}
          disabled={!c.suitable}
          onPress={() => router.push(sellingRoutes.call(vacancyId, c.jobSeekerId))}
          testID="call-to-confirm"
        />
      </View>
      <Note>{t('fa15d.neverShown')}</Note>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flexBody: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: fonts.display700, fontSize: 19, lineHeight: 25, color: colors.white },
  sub: { fontFamily: fonts.body500, fontSize: 13, lineHeight: 18, color: colors.onBlueSoft },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});
