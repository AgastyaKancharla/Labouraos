import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { BusinessHome, StepState, VacancyStatus } from '@/api/types';
import { Banner, Button, Card, ListRow, StatusChip, StepList, Text } from '@/components';
import { useI18n } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { rupees } from '@/lib/money';
import { routes } from '@/navigation/routes';
import type { Tone } from '@/theme';
import { useSecureSheet } from '../shared/useSecureSheet';

const VACANCY_TONE: Record<VacancyStatus, Tone> = {
  draft: 'neutral',
  awaiting_otp: 'amber',
  waiting_for_visit: 'cyan',
  open: 'green',
  filled: 'blue',
  closed: 'neutral',
};

/**
 * Business Home: the tracker Phone verified → Agreement → Visit → Approval
 * → Verified (guide, "After saving"), vacancies with their state, and
 * interviews and placements as counts. No candidate details at all in this
 * first version — and never a candidate's phone number (no-bypass).
 */
export function BusinessHomeView({ profileId, home }: { profileId: string; home: BusinessHome }) {
  const { t } = useI18n();
  const sheet = useSecureSheet();
  const tr = home.tracker;
  const visitState: StepState = tr.visit === 'done' ? 'done' : tr.visit === 'not_booked' ? 'not_started' : 'in_progress';
  const approvalState: StepState = tr.approval === 'approved' ? 'done' : tr.visit === 'done' ? 'in_progress' : 'not_started';
  const verified = tr.agreement === 'signed' && tr.visit === 'done' && tr.approval === 'approved';

  return (
    <View style={styles.gap} testID="biz-home">
      <Card title={t('bizHome.trackerTitle')}>
        <View style={styles.gap}>
          <StepList
            testID="biz-step"
            steps={[
              { key: 'phone', label: t('bizHome.stepPhone'), state: tr.phoneVerified ? 'done' : 'not_started' },
              { key: 'agreement', label: t('bizHome.stepAgreement'), state: tr.agreement === 'signed' ? 'done' : 'not_started' },
              { key: 'visit', label: t('bizHome.stepVisit'), state: visitState },
              { key: 'approval', label: t('bizHome.stepApproval'), state: approvalState },
              { key: 'verified', label: t('bizHome.stepVerified'), state: verified ? 'done' : 'not_started' },
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

      <Card title={t('bizHome.vacanciesTitle')} testID="biz-home-vacancies">
        {home.vacancies.length === 0 ? <Text variant="muted">{t('bizHome.noVacancies')}</Text> : null}
        {home.vacancies.map((v, i) => {
          const salary = v.salaryMinPaise
            ? `${rupees(v.salaryMinPaise)}${v.salaryMaxPaise ? `–${rupees(v.salaryMaxPaise)}` : ''} ${v.salaryPeriod === 'daily' ? t('form.perDayShort') : t('form.perMonthShort')}`
            : null;
          const needsOtp = v.status === 'draft' || v.status === 'awaiting_otp';
          return (
            <View key={v.id}>
              <ListRow
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

      <Card title={t('bizHome.countsTitle')}>
        <ListRow title={t('bizHome.interviewsUpcoming')} trailing={<Text variant="stat">{home.counts.interviewsUpcoming}</Text>} />
        <ListRow title={t('bizHome.placements')} trailing={<Text variant="stat">{home.counts.placements}</Text>} last />
      </Card>
      {sheet.error ? <Banner tone="error" message={sheet.error} /> : null}
      {sheet.outcome === 'opened_in_browser' ? <Banner tone="info" message={t('sheet.openedInBrowser')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 }, top: { paddingTop: 12 } });
