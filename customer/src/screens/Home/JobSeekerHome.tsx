import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { JobSeekerHome } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Button, Card, ProgressBar, StepList, Text } from '@/components';
import { formatDateKey } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { rupees } from '@/lib/money';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { useSecureSheet } from '../shared/useSecureSheet';

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
export function JobSeekerHomeView({ profileId, home }: { profileId: string; home: JobSeekerHome }) {
  const { t } = useI18n();
  const { account } = useAuth();
  const sheet = useSecureSheet();
  const registrationDone = home.payment.status !== 'not_paid';
  const g = home.guarantee;
  const hasPartner = (account?.profiles ?? []).some((p) => p.kind === 'referral_partner');

  return (
    <View style={styles.gap} testID="js-home">
      {!registrationDone ? (
        <Card title={t('jsHome.finishTitle')} testID="js-home-steps">
          <View style={styles.gap}>
            <StepList
              testID="js-step"
              steps={[
                { key: 'phone', label: t('jsHome.stepPhone'), state: home.steps.phone },
                { key: 'profile', label: t('jsHome.stepProfile'), state: home.steps.profile },
                { key: 'consent', label: t('jsHome.stepConsent'), state: home.steps.consent },
                { key: 'selfie', label: t('jsHome.stepSelfie'), state: home.steps.selfie },
                { key: 'idCheck', label: t('jsHome.stepId'), state: home.steps.idCheck },
                { key: 'payment', label: t('jsHome.stepPayment', { amount: rupees(home.payment.amountPaise) }), state: home.steps.payment },
              ]}
            />
            {home.stuckReason ? <Banner tone="warn" message={home.stuckReason} testID="js-home-stuck" /> : null}
            <Text variant="muted">{t('jsHome.payLast')}</Text>
            <Button label={t('jsHome.continue')} loading={sheet.busy} onPress={() => void sheet.open(profileId, 'registration')} testID="js-home-continue" />
            <Button label={t('jsHome.needHelp')} variant="secondary" onPress={() => router.push(routes.help)} testID="js-home-help" />
          </View>
        </Card>
      ) : null}

      {home.payment.status === 'confirming' ? (
        <Banner tone="info" title={t('jsHome.confirmingTitle')} message={t('jsHome.confirming')} testID="js-home-confirming" />
      ) : null}

      {g.status === 'running' && g.day !== null ? (
        <Card title={t('jsHome.guaranteeTitle')} testID="js-home-running">
          <View style={styles.gap}>
            <Text variant="h1">{t('jsHome.dayOf', { day: g.day, total: g.totalDays })}</Text>
            <ProgressBar value={g.day / g.totalDays} />
            <Text>{t('jsHome.finding')}</Text>
            {g.endsOn ? <Text variant="muted">{t('jsHome.endsOn', { date: formatDateKey(g.endsOn) })}</Text> : null}
          </View>
        </Card>
      ) : null}

      {registrationDone && g.status !== 'not_started' ? (
        <Card title={t('jsHome.hitsTitle')} testID="js-home-hits">
          <View style={styles.gap}>
            <Text variant="h2" color={g.hits > 0 ? colors.crit : colors.navy}>
              {t('jsHome.hits', { hits: g.hits, max: g.maxHits })}
            </Text>
            <Text variant="muted">{t('jsHome.hitsExplain')}</Text>
          </View>
        </Card>
      ) : null}

      {g.status === 'placed' ? <Banner tone="ok" title={t('jsHome.placedTitle')} message={t('jsHome.placed')} testID="js-home-placed" /> : null}
      {g.status === 'ended' ? <Banner tone="info" message={t('jsHome.ended')} testID="js-home-ended" /> : null}
      {g.status === 'deactivated' ? (
        <Card testID="js-home-deactivated">
          <View style={styles.gap}>
            <Banner tone="warn" title={t('jsHome.deactivatedTitle')} message={t('jsHome.deactivated', { amount: rupees(home.payment.amountPaise) })} />
            <Button label={t('jsHome.payAgain', { amount: rupees(home.payment.amountPaise) })} loading={sheet.busy} onPress={() => void sheet.open(profileId, 'registration')} testID="js-home-pay-again" />
          </View>
        </Card>
      ) : null}

      {home.interview && home.interview.status === 'booked' ? (
        <Card title={t('jsHome.interviewTitle')} testID="js-home-interview">
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
        <Card title={t('jsHome.refundTitle')} testID={`js-home-refund-${home.refund.status}`}>
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
      {sheet.error ? <Banner tone="error" message={sheet.error} /> : null}
      {sheet.outcome === 'opened_in_browser' ? <Banner tone="info" message={t('sheet.openedInBrowser')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 } });
