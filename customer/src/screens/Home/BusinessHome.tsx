import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { BusinessHome, StepState, VacancyStatus } from '@/api/types';
import { Banner, Button, Card, EmptyState, HeroCard, IconTile, ListRow, StatGrid, StatTile, StatusChip, StepList, Text } from '@/components';
import { useI18n } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { rupees } from '@/lib/money';
import { routes } from '@/navigation/routes';
import type { Accent, Tone } from '@/theme';
import type { HeroInfo } from './hero';
import { ShiftsCard } from '../shared/Shifts';
import { BusinessInterviews } from './BusinessInterviews';

/** Hero chip tone for a tracker step: done green, waiting amber, booked cyan, not started grey, paused red. */
const STEP_TONE: Record<StepState, Tone> = { done: 'green', in_progress: 'amber', not_started: 'neutral' };

const VACANCY_TONE: Record<VacancyStatus, Tone> = {
  draft: 'neutral',
  awaiting_otp: 'amber',
  waiting_for_visit: 'cyan',
  open: 'green',
  filled: 'blue',
  closed: 'neutral',
  being_checked: 'amber',
};

/** The vacancy's icon tile, in the palette colour of its state. */
const VACANCY_ACCENT: Record<VacancyStatus, Accent> = {
  draft: 'navy',
  awaiting_otp: 'gold',
  waiting_for_visit: 'cyan',
  open: 'good',
  filled: 'royal',
  closed: 'navy',
  being_checked: 'gold',
};

/**
 * Business Home: the tracker Phone verified → Agreement → (Visit, only when
 * one is asked for or booked — rev 211 shops get none) → Approval → Verified,
 * vacancies with their state, the interview cards (26 Nov: first name, age,
 * trade, years, languages, photo) and counts. Never a candidate's surname or
 * phone number (no-bypass).
 */
export function BusinessHomeView({ profileId, home, hero, belowHero }: { profileId: string; home: BusinessHome; hero: HeroInfo; belowHero?: ReactNode }) {
  const { t } = useI18n();
  const api = useCustomerApi();
  // "Report a worker left" shows only once the server switches it on (contract 8.2).
  const config = useQuery({ queryKey: queryKeys.config, queryFn: () => api.config(), staleTime: 10 * 60_000 });
  const tr = home.tracker;
  const visitState: StepState = tr.visit === 'done' ? 'done' : tr.visit === 'not_booked' ? 'not_started' : 'in_progress';
  // Rev 211: a shop is checked automatically after signing; only a household waits for a visit.
  const approvalState: StepState = tr.approval === 'approved' ? 'done' : tr.agreement === 'signed' ? 'in_progress' : 'not_started';
  const verified = tr.agreement === 'signed' && tr.approval === 'approved';
  const agreementState: StepState = tr.agreement === 'signed' ? 'done' : 'not_started';
  const heroChips: { key: string; label: string; state: StepState; tone: Tone }[] = [
    { key: 'agreement', label: t('bizHome.stepAgreement'), state: agreementState, tone: agreementState === 'done' ? 'green' : 'amber' },
    ...(tr.visit === 'not_booked' ? [] : [{ key: 'visit', label: t('bizHome.stepVisit'), state: visitState, tone: (tr.visit === 'booked' ? 'cyan' : STEP_TONE[visitState]) as Tone }]),
    { key: 'approval', label: t('bizHome.stepApproval'), state: approvalState, tone: tr.approval === 'paused' ? 'tomato' : STEP_TONE[approvalState] },
  ];

  return (
    <View style={styles.gap} testID="biz-home">
      {home.suspension ? (
        // D6 (rev 176): suspended by the CEO.
        <Banner
          tone="error"
          testID="biz-home-suspended"
          message={
            home.suspension.permanent || !home.suspension.until
              ? t('bizHome.suspendedForever', { reason: home.suspension.reason ?? '—' })
              : t('bizHome.suspended', { until: formatDayIst(home.suspension.until), reason: home.suspension.reason ?? '—' })
          }
        />
      ) : null}
      <HeroCard eyebrow={hero.eyebrow} title={hero.title} emoji={verified ? '✅' : '🏪'} testID="biz-home-hero">
        <View style={styles.chips}>
          {heroChips.map((c) => (
            <StatusChip
              key={c.key}
              // Done: the step's name with a tick. Not done: the name and its state in words (never colour alone).
              label={c.state === 'done' ? c.label : c.key === 'agreement' ? t('bizHome.signAgreement') : `${c.label}: ${t(`step.${c.state}`)}`}
              tone={c.tone}
              icon={c.state === 'done' ? 'check' : undefined}
              dot={c.state !== 'done'}
              accessibilityLabel={`${c.label}: ${t(`step.${c.state}`)}`}
              testID={`biz-hero-${c.key}-${c.tone}`}
            />
          ))}
        </View>
      </HeroCard>
      {belowHero}

      <StatGrid>
        <StatTile label={t('bizHome.vacanciesTitle')} value={home.vacancies.length} accent="royal" icon="briefcase" testID="biz-stat-vacancies" />
        <StatTile label={t('bizHome.interviewsUpcoming')} value={home.counts.interviewsUpcoming} accent="cyan" icon="calendar" testID="biz-stat-interviews" />
        <StatTile label={t('bizHome.placements')} value={home.counts.placements} accent="good" icon="users" testID="biz-stat-placements" />
      </StatGrid>

      <BusinessInterviews profileId={profileId} interviews={home.interviews} />

      <Card title={t('bizHome.trackerTitle')} accent="navy">
        <View style={styles.gap}>
          <StepList
            testID="biz-step"
            steps={[
              { key: 'phone', label: t('bizHome.stepPhone'), state: tr.phoneVerified ? 'done' : 'not_started', icon: 'phone', accent: 'royal' },
              { key: 'agreement', label: t('bizHome.stepAgreement'), state: agreementState, icon: 'doc', accent: 'navy' },
              ...(tr.visit === 'not_booked' ? [] : [{ key: 'visit', label: t('bizHome.stepVisit'), state: visitState, icon: 'calendar' as const, accent: 'cyan' as const }]),
              { key: 'approval', label: t('bizHome.stepApproval'), state: approvalState, icon: 'check', accent: 'gold' },
              { key: 'verified', label: t('bizHome.stepVerified'), state: verified ? 'done' : 'not_started', icon: 'shield', accent: 'good' },
            ]}
          />
          {tr.agreement !== 'signed' ? (
            <Button label={t('bizHome.signAgreement')} onPress={() => router.push(routes.verify('business_agreement', profileId))} testID="biz-home-sign" />
          ) : null}
          {tr.visit === 'requested' ? <Text testID="biz-home-visit-requested">{t('bizHome.visitRequested')}</Text> : null}
          {tr.visit === 'booked' && tr.visitAt ? (
            <Text variant="bodyStrong" testID="biz-home-visit-booked">
              {tr.visitAgentFirstName
                ? t('bizHome.visitBookedWith', { name: tr.visitAgentFirstName, day: formatDayIst(tr.visitAt), time: formatTimeIst(tr.visitAt) })
                : t('bizHome.visitBooked', { day: formatDayIst(tr.visitAt), time: formatTimeIst(tr.visitAt) })}
            </Text>
          ) : null}
          {tr.approval === 'paused' ? <Banner tone="warn" message={t('bizHome.paused')} testID="biz-home-paused" /> : null}
        </View>
      </Card>

      {!verified ? <Banner tone="info" message={t('bizHome.candidatesAfterVisit')} testID="biz-home-after-visit" /> : null}

      <Card title={t('bizHome.vacanciesTitle')} accent="orange" testID="biz-home-vacancies">
        {home.vacancies.length === 0 ? <EmptyState compact emoji="🧑‍🍳" message={t('bizHome.noVacancies')} /> : null}
        {home.vacancies.map((v, i) => {
          const salary = v.salaryMinPaise
            ? `${rupees(v.salaryMinPaise)}${v.salaryMaxPaise ? `–${rupees(v.salaryMaxPaise)}` : ''} ${v.salaryPeriod === 'daily' ? t('form.perDayShort') : t('form.perMonthShort')}`
            : null;
          const needsOtp = v.status === 'draft' || v.status === 'awaiting_otp';
          return (
            <View key={v.id}>
              <ListRow
                leading={<IconTile icon="briefcase" accent={VACANCY_ACCENT[v.status]} size={34} round />}
                title={`${v.roleTitle || v.trade}${v.openings ? ` × ${v.openings}` : ''}`}
                subtitle={[salary, v.code, v.belowLegalMinimum ? t('bizHome.belowMinimum') : null].filter(Boolean).join(' · ') || undefined}
                trailing={<StatusChip label={t(`vacancyStatus.${v.status}`)} tone={VACANCY_TONE[v.status]} />}
                last={i === home.vacancies.length - 1 && !needsOtp}
                testID={`biz-home-vacancy-${v.id}`}
              />
              {needsOtp ? (
                <Button label={t('bizHome.confirmVacancy')} variant="secondary" onPress={() => router.push(routes.confirmVacancy(v.id))} testID={`biz-home-confirm-${v.id}`} />
              ) : null}
            </View>
          );
        })}
        <View style={styles.top}>
          <Button label={t('bizHome.addVacancy')} onPress={() => router.push(routes.addVacancy)} testID="biz-home-add-vacancy" />
        </View>
      </Card>

      {config.data?.workerLeftReports && home.counts.workersPlaced > 0 ? (
        <Card title={t('bizHome.workersTitle')} accent="gold" emoji="👷" testID="biz-home-workers">
          <View style={styles.gap}>
            <Text>{t('bizHome.workersIntro')}</Text>
            <Button label={t('bizHome.workersButton')} variant="secondary" onPress={() => router.push(routes.workers)} testID="biz-home-worker-left" />
          </View>
        </Card>
      ) : null}

      <ShiftsCard profileId={profileId} />

    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 }, top: { paddingTop: 12 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
