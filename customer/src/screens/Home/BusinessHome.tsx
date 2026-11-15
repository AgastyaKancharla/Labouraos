import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { BusinessHome, StepState, VacancyStatus } from '@/api/types';
import { Banner, Button, Card, EmptyState, HeroCard, IconTile, ListRow, StatGrid, StatTile, StatusChip, StepList, Text } from '@/components';
import { useI18n } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { rupees } from '@/lib/money';
import { routes } from '@/navigation/routes';
import type { Accent, Tone } from '@/theme';
import type { HeroInfo } from './hero';
import { useSecureSheet } from '../shared/useSecureSheet';

/** Hero chip tone for a tracker step: done green, waiting amber, booked cyan, not started grey, paused red. */
const STEP_TONE: Record<StepState, Tone> = { done: 'green', in_progress: 'amber', not_started: 'neutral' };

const VACANCY_TONE: Record<VacancyStatus, Tone> = {
  draft: 'neutral',
  awaiting_otp: 'amber',
  waiting_for_visit: 'cyan',
  open: 'green',
  filled: 'blue',
  closed: 'neutral',
};

/** The vacancy's icon tile, in the palette colour of its state. */
const VACANCY_ACCENT: Record<VacancyStatus, Accent> = {
  draft: 'navy',
  awaiting_otp: 'gold',
  waiting_for_visit: 'cyan',
  open: 'good',
  filled: 'royal',
  closed: 'navy',
};

/**
 * Business Home: the tracker Phone verified → Agreement → Visit → Approval
 * → Verified (guide, "After saving"), vacancies with their state, and
 * interviews and placements as counts. No candidate details at all in this
 * first version — and never a candidate's phone number (no-bypass).
 */
export function BusinessHomeView({ profileId, home, hero }: { profileId: string; home: BusinessHome; hero: HeroInfo }) {
  const { t } = useI18n();
  const sheet = useSecureSheet();
  const tr = home.tracker;
  const visitState: StepState = tr.visit === 'done' ? 'done' : tr.visit === 'not_booked' ? 'not_started' : 'in_progress';
  const approvalState: StepState = tr.approval === 'approved' ? 'done' : tr.visit === 'done' ? 'in_progress' : 'not_started';
  const verified = tr.agreement === 'signed' && tr.visit === 'done' && tr.approval === 'approved';
  const agreementState: StepState = tr.agreement === 'signed' ? 'done' : 'not_started';
  const heroChips: { key: string; label: string; state: StepState; tone: Tone }[] = [
    { key: 'agreement', label: t('bizHome.stepAgreement'), state: agreementState, tone: agreementState === 'done' ? 'green' : 'amber' },
    { key: 'visit', label: t('bizHome.stepVisit'), state: visitState, tone: tr.visit === 'booked' ? 'cyan' : STEP_TONE[visitState] },
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

      <StatGrid>
        <StatTile label={t('bizHome.vacanciesTitle')} value={home.vacancies.length} accent="royal" icon="briefcase" testID="biz-stat-vacancies" />
        <StatTile label={t('bizHome.interviewsUpcoming')} value={home.counts.interviewsUpcoming} accent="cyan" icon="calendar" testID="biz-stat-interviews" />
        <StatTile label={t('bizHome.placements')} value={home.counts.placements} accent="good" icon="users" testID="biz-stat-placements" />
      </StatGrid>

      <Card title={t('bizHome.trackerTitle')} accent="navy">
        <View style={styles.gap}>
          <StepList
            testID="biz-step"
            steps={[
              { key: 'phone', label: t('bizHome.stepPhone'), state: tr.phoneVerified ? 'done' : 'not_started', icon: 'phone', accent: 'royal' },
              { key: 'agreement', label: t('bizHome.stepAgreement'), state: agreementState, icon: 'doc', accent: 'navy' },
              { key: 'visit', label: t('bizHome.stepVisit'), state: visitState, icon: 'calendar', accent: 'cyan' },
              { key: 'approval', label: t('bizHome.stepApproval'), state: approvalState, icon: 'check', accent: 'gold' },
              { key: 'verified', label: t('bizHome.stepVerified'), state: verified ? 'done' : 'not_started', icon: 'shield', accent: 'good' },
            ]}
          />
          {tr.agreement !== 'signed' ? (
            <Button label={t('bizHome.signAgreement')} loading={sheet.busy} onPress={() => void sheet.open(profileId, 'business_agreement')} testID="biz-home-sign" />
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

      {sheet.error ? <Banner tone="error" message={sheet.error} /> : null}
      {sheet.outcome === 'opened_in_browser' ? <Banner tone="info" message={t('sheet.openedInBrowser')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 }, top: { paddingTop: 12 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
