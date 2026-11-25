import type { ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { JobSeekerHome } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Button, Card, HeroCard, heroText, ProgressBar, StepList, Text, type StepItem } from '@/components';
import { formatDateKey } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { rupees } from '@/lib/money';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import type { HeroInfo } from './hero';

/** Google Maps directions to the interview (opens the maps app or browser). */
export function directionsUrl(i: NonNullable<JobSeekerHome['interview']>): string {
  const destination = i.latitude !== null && i.longitude !== null ? `${i.latitude},${i.longitude}` : i.address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/**
 * Job seeker Home: steps done, "Paid — confirming", day X of 30, hits,
 * interview booked (business name ONLY then — no-bypass), refund status.
 * The guarantee rules are the guide's; the app only shows them.
 */
export function JobSeekerHomeView({ profileId, home, hero, belowHero }: { profileId: string; home: JobSeekerHome; hero: HeroInfo; belowHero?: ReactNode }) {
  const { t } = useI18n();
  const { account } = useAuth();
  const g = home.guarantee;
  // Rev 211: paid but the ID check is still to do → registration is not finished yet.
  const waitingId = g.status === 'waiting_id';
  const registrationDone = home.payment.status !== 'not_paid' && !waitingId;
  const hasPartner = (account?.profiles ?? []).some((p) => p.kind === 'referral_partner');
  // Each step has its own colour and drawn icon (Master Guide: colour-coded steps).
  const steps: StepItem[] = [
    { key: 'phone', label: t('jsHome.stepPhone'), state: home.steps.phone, icon: 'phone', accent: 'royal' },
    { key: 'profile', label: t('jsHome.stepProfile'), state: home.steps.profile, icon: 'user', accent: 'navy' },
    { key: 'consent', label: t('jsHome.stepConsent'), state: home.steps.consent, icon: 'doc', accent: 'cyan' },
    { key: 'selfie', label: t('jsHome.stepSelfie'), state: home.steps.selfie, icon: 'camera', accent: 'gold' },
    // Rev 211 order: Consent → Selfie → Payment → ID check.
    { key: 'payment', label: t('jsHome.stepPayment', { amount: rupees(home.payment.amountPaise) }), state: home.steps.payment, icon: 'rupee', accent: 'good' },
    { key: 'idCheck', label: t('jsHome.stepId'), state: home.steps.idCheck, icon: 'id-card', accent: 'orange' },
  ];
  const doneCount = steps.filter((s) => s.state === 'done').length;
  const nextStep = steps.find((s) => s.state !== 'done');
  const heroEmoji = !registrationDone
    ? '📝'
    : home.payment.status === 'confirming'
      ? '⏳'
      : g.status === 'running'
        ? '🔍'
        : g.status === 'placed'
          ? '🎉'
          : g.status === 'deactivated'
            ? '⏸️'
            : g.status === 'ended'
              ? '🗓️'
              : '👋';

  return (
    <View style={styles.gap} testID="js-home">
      <HeroCard eyebrow={hero.eyebrow} title={hero.title} emoji={heroEmoji} testID="js-home-hero">
        {waitingId ? (
          <View style={styles.heroBlock} testID="js-home-waiting-id">
            <Text style={heroText.label}>{t('jsHome.waitingIdTitle')}</Text>
            <Text style={heroText.big}>{t('jsHome.stepId')}</Text>
            <Text style={heroText.body}>{t('jsHome.waitingId')}</Text>
          </View>
        ) : !registrationDone ? (
          <View style={styles.heroBlock} testID="js-home-hero-next">
            <Text style={heroText.label}>{t('jsHome.finishTitle')}</Text>
            {nextStep ? <Text style={heroText.big}>{nextStep.label}</Text> : null}
            <ProgressBar value={doneCount / steps.length} color={colors.goldRaw} trackColor={colors.heroTrack} />
          </View>
        ) : home.payment.status === 'confirming' ? (
          <View style={styles.heroBlock} testID="js-home-confirming">
            <Text style={heroText.big}>{t('jsHome.confirmingTitle')}</Text>
            <Text style={heroText.body}>{t('jsHome.confirming')}</Text>
          </View>
        ) : g.status === 'running' && g.day !== null ? (
          <View style={styles.heroBlock} testID="js-home-running">
            <Text style={heroText.label}>{t('jsHome.guaranteeTitle')}</Text>
            <Text style={heroText.big}>{t('jsHome.dayOf', { day: g.day, total: g.totalDays })}</Text>
            <ProgressBar value={g.day / g.totalDays} color={colors.cyanRaw} trackColor={colors.heroTrack} />
            <Text style={heroText.body}>{t('jsHome.finding')}</Text>
            {g.endsOn ? <Text style={heroText.soft}>{t('jsHome.endsOn', { date: formatDateKey(g.endsOn) })}</Text> : null}
          </View>
        ) : g.status === 'placed' ? (
          <View style={styles.heroBlock} testID="js-home-placed">
            <Text style={heroText.big}>{t('jsHome.placedTitle')}</Text>
            <Text style={heroText.body}>{t('jsHome.placed')}</Text>
          </View>
        ) : g.status === 'ended' ? (
          <View style={styles.heroBlock} testID="js-home-ended">
            <Text style={heroText.big}>{t('jsHome.ended')}</Text>
          </View>
        ) : g.status === 'deactivated' ? (
          <View style={styles.heroBlock}>
            <Text style={heroText.big}>{t('jsHome.deactivatedTitle')}</Text>
          </View>
        ) : null}
      </HeroCard>
      {belowHero}

      {!registrationDone ? (
        <Card title={t('jsHome.finishTitle')} accent="royal" testID="js-home-steps">
          <View style={styles.gap}>
            <StepList testID="js-step" steps={steps} />
            {home.stuckReason ? <Banner tone="warn" message={home.stuckReason} testID="js-home-stuck" /> : null}
            {waitingId ? <Banner tone="info" message={t('jsHome.waitingId')} testID="js-home-waiting-id-note" /> : <Text variant="muted">{t('jsHome.payLast')}</Text>}
            <Button label={t('jsHome.continue')} onPress={() => router.push(routes.verify('registration', profileId))} testID="js-home-continue" />
            <Button label={t('jsHome.needHelp')} variant="secondary" onPress={() => router.push(routes.help)} testID="js-home-help" />
          </View>
        </Card>
      ) : null}

      {registrationDone && g.status !== 'not_started' ? (
        <Card title={t('jsHome.hitsTitle')} accent={g.hits > 0 ? 'orange' : 'good'} testID="js-home-hits">
          <View style={styles.gap}>
            <Text variant="h2" color={g.hits > 0 ? colors.crit : colors.navy}>
              {t('jsHome.hits', { hits: g.hits, max: g.maxHits })}
            </Text>
            <Text variant="muted">{t('jsHome.hitsExplain')}</Text>
          </View>
        </Card>
      ) : null}

      {g.status === 'deactivated' ? (
        <Card accent="gold" testID="js-home-deactivated">
          <View style={styles.gap}>
            <Banner tone="warn" message={t('jsHome.deactivated', { amount: rupees(home.payment.amountPaise) })} />
            <Button label={t('jsHome.payAgain', { amount: rupees(home.payment.amountPaise) })} onPress={() => router.push(routes.verify('registration', profileId))} testID="js-home-pay-again" />
          </View>
        </Card>
      ) : null}

      {home.interview && home.interview.status === 'booked' ? (
        <Card title={t('jsHome.interviewTitle')} accent="orange" emoji="📅" testID="js-home-interview">
          <View style={styles.gap}>
            <Text variant="h2" testID="js-home-interview-business">
              {home.interview.businessName}
            </Text>
            {home.interview.trade ? <Text>{home.interview.trade}</Text> : null}
            <Text>{home.interview.address}</Text>
            <Text variant="bodyStrong">{t('jsHome.interviewAt', { day: formatDayIst(home.interview.startsAt), time: formatTimeIst(home.interview.startsAt) })}</Text>
            {home.interview.replyDueAt ? (
              <Text variant="muted">{t('jsHome.replyBy', { day: formatDayIst(home.interview.replyDueAt), time: formatTimeIst(home.interview.replyDueAt) })}</Text>
            ) : null}
            <Button label={t('jsHome.directions')} variant="secondary" onPress={() => void Linking.openURL(directionsUrl(home.interview!))} testID="js-home-directions" />
            <Text variant="muted">{t('jsHome.interviewCall')}</Text>
          </View>
        </Card>
      ) : null}

      {home.refund ? (
        <Card title={t('jsHome.refundTitle')} accent="royal" emoji="💸" testID={`js-home-refund-${home.refund.status}`}>
          <Text>
            {home.refund.status === 'due'
              ? t('jsHome.refundDue', { amount: rupees(home.refund.amountPaise), date: home.refund.dueOn ? formatDateKey(home.refund.dueOn) : '—' })
              : home.refund.status === 'with_finance'
                ? t('jsHome.refundWithFinance', { amount: rupees(home.refund.amountPaise) })
                : home.refund.status === 'paid'
                  ? t('jsHome.refundPaid', { amount: rupees(home.refund.amountPaise), ref: home.refund.upiRef ?? '—' })
                  : t('jsHome.refundNotEligible')}
          </Text>
        </Card>
      ) : null}

      {!hasPartner && registrationDone ? (
        <Button label={t('jsHome.referFriend')} variant="secondary" onPress={() => router.push(routes.registerReferral)} testID="js-home-refer" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 }, heroBlock: { gap: 8 } });
