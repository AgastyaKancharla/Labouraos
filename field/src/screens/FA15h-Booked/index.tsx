import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { InterviewView } from '@/api/endpoints';
import { Banner, Button, Card, Screen } from '@/components';
import { formatClock } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { routes, sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { Note, QueryView, StepRow, useParam, useSellingSettings } from '../_selling';

/**
 * FA15h — Interview booked. What happens next, all automatic: the candidate
 * gets the offer (time, then the address once he says yes) by SMS and
 * WhatsApp; the agent attends and marks "candidate arrived" (if attending);
 * the owner records the result by 8 PM by OTP; selected → the fee + GST is
 * paid within 24 hours. His other offers are paused while this one is live.
 */
export default function BookedScreen() {
  const { t } = useI18n();
  const id = useParam('id');
  const { selling } = useEndpoints();
  const interview = useQuery({ queryKey: queryKeys.sellingInterview(id), queryFn: () => selling.interview(id), enabled: !!id });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa15h.subtitle')} />
      <Screen testID="screen-FA15h">
        <QueryView query={interview}>{(i) => <Booked interview={i} />}</QueryView>
      </Screen>
    </View>
  );
}

function Booked({ interview: i }: { interview: InterviewView }) {
  const { t } = useI18n();
  const settings = useSellingSettings();
  const day = formatDayIst(i.slotStartsAt);
  const when = i.interviewType === 'walk_in'
    ? `${day}, ${formatTimeIst(i.slotStartsAt)} – ${formatTimeIst(i.slotEndsAt)}`
    : `${day}, ${formatTimeIst(i.slotStartsAt)}`;
  const deadline = settings.data ? formatClock(settings.data.interviewResultDeadline) : '';
  const hours = settings.data?.placementPaymentDueHours ?? '';
  const dayShort = day.split(' ')[0];
  return (
    <>
      <Banner tone="ok" title={t('fa15h.booked', { when })} testID="booked" />
      <Card title={t('fa15h.next')}>
        <StepRow
          label={i.interviewType === 'phone' ? t('fa15h.phoneCall', { name: i.candidate.firstName }) : t('fa15h.candidateMessages', { name: i.candidate.firstName })}
          chip={i.offerMessagesSent > 0 ? t('fa15q.sent') : t('fa15h.sending')}
          tone={i.offerMessagesSent > 0 ? 'green' : 'amber'}
        />
        {i.agentWillAttend ? <StepRow label={t('fa15h.youAttend')} chip={dayShort} tone="blue" /> : null}
        <StepRow label={t('fa15h.ownerResult', { time: deadline })} chip={dayShort} tone="blue" />
        <StepRow label={t('fa15h.payWithin', { hours })} chip={t('fa15h.then')} last />
      </Card>
      <Note>{t('fa15h.note', { name: i.candidate.firstName })}</Note>
      <View style={styles.row}>
        <Button
          label={t('fa15h.bookAnother')}
          style={styles.flex1}
          onPress={() => router.replace(sellingRoutes.matches(i.business.id, i.vacancy.id))}
          testID="book-another"
        />
        <Button label={t('tabs.home')} variant="secondary" style={styles.flex1} onPress={() => router.replace(routes.home)} testID="home" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
});
