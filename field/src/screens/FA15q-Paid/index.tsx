import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { PlacementView } from '@/api/endpoints';
import { Banner, Button, Card, Screen } from '@/components';
import { useI18n } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { routes, sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { formatRupees, QueryView, StepRow, useParam } from '../_selling';

const PAYMENT_POLL_MS = 5000;

export function isPaid(p: PlacementView): boolean {
  return Boolean(p.paidAt) || ['confirmed', 'active', 'completed'].includes(p.status);
}

/**
 * FA15q — Paid: details shared. Only once the bank confirms the payment are
 * the candidate's details shared with the business and his joining date
 * confirmed to him (all automatic). Waits for the bank until then — a
 * screenshot is never proof of payment.
 */
export default function PaidScreen() {
  const { t } = useI18n();
  const id = useParam('id');
  const { selling } = useEndpoints();
  const placement = useQuery({
    queryKey: queryKeys.sellingPlacement(id),
    queryFn: () => selling.placement(id),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && isPaid(q.state.data) ? false : PAYMENT_POLL_MS),
  });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa15q.subtitle')} />
      <Screen testID="screen-FA15q" onRefresh={() => void placement.refetch()} refreshing={placement.isRefetching}>
        <QueryView query={placement}>{(p) => <Paid placement={p} />}</QueryView>
      </Screen>
    </View>
  );
}

function Paid({ placement: p }: { placement: PlacementView }) {
  const { t } = useI18n();
  const paid = isPaid(p);
  const next = p.nextVacancies[0];
  const joining = p.joiningDate ? formatDayIst(p.joiningDate) : '—';
  return (
    <>
      {paid ? (
        <Banner
          tone="ok"
          title={t('fa15q.received', { amount: formatRupees(p.totalPaise) })}
          message={t('fa15q.byBank', { time: p.paymentConfirmedAt || p.paidAt ? formatTimeIst((p.paymentConfirmedAt ?? p.paidAt)!) : '' })}
          testID="paid"
        />
      ) : (
        <Banner tone="warn" title={t('fa15q.waiting', { amount: formatRupees(p.totalPaise) })} message={t('fa15q.waitingBody')} testID="waiting-bank" />
      )}
      <Card title={t('fa15q.auto')}>
        <StepRow label={t('fa15q.detailsShared', { name: p.candidate.firstName, owner: p.business.contactName ?? p.business.name })} chip={paid ? t('fa15q.sent') : t('fa15q.afterPayment')} tone={paid ? 'green' : 'neutral'} />
        <StepRow label={t('fa15q.toldJoining', { name: p.candidate.firstName, date: joining })} chip={paid ? t('fa15q.smsWhatsapp') : t('fa15q.afterPayment')} tone={paid ? 'green' : 'neutral'} />
        <StepRow label={t('fa15q.invoice', { business: p.business.name })} chip={p.invoiceCode ? t('fa15q.emailed') : t('fa15q.afterPayment')} tone={p.invoiceCode ? 'green' : 'neutral'} />
        <StepRow label={t('fa15q.joiningCalls', { date: joining })} chip={paid ? t('fa15q.scheduled') : t('fa15q.afterPayment')} tone={paid ? 'blue' : 'neutral'} last />
      </Card>
      <View style={styles.row}>
        {next ? (
          <Button
            label={t('fa15q.nextRole', { trade: next.trade })}
            style={styles.flex1}
            onPress={() => router.replace(sellingRoutes.matches(p.business.id, next.id))}
            testID="next-role"
          />
        ) : null}
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
