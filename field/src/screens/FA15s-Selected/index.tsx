import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { InterviewView } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Button, Card, Screen, StatusChip, Text } from '@/components';
import { DateField, MoneyField, todayKeyIst } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { sellingRoutes } from '@/navigation/routes';
import { colors, fonts } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { feeBreakdown, formatRupees, KeyValue, Note, QueryView, useParam, useSellingSettings } from '../_selling';
import { OtpStep } from '../_selling/OtpStep';

/**
 * FA15s — Selected on the call. 1: the owner confirms the monthly salary and
 * joining date on his own phone by OTP. 2: the fee (from Settings: 50% + 18%
 * GST) is due now — the payment link / QR goes to the owner straight away;
 * the agent never collects money. Once paid → FA15q.
 */
export default function SelectedScreen() {
  const { t } = useI18n();
  const id = useParam('id');
  const { selling } = useEndpoints();
  const interview = useQuery({ queryKey: queryKeys.sellingInterview(id), queryFn: () => selling.interview(id), enabled: !!id });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa15s.subtitle')} />
      <Screen testID="screen-FA15s">
        <QueryView query={interview}>{(i) => <Selected interview={i} />}</QueryView>
      </Screen>
    </View>
  );
}

function Selected({ interview: i }: { interview: InterviewView }) {
  const { t } = useI18n();
  const { session } = useAuth();
  const { selling } = useEndpoints();
  const client = useQueryClient();
  const settings = useSellingSettings();
  const [salary, setSalary] = useState<number | null>(i.vacancy.salaryPeriod === 'daily' ? null : i.vacancy.salaryMinPaise);
  const [joining, setJoining] = useState('');
  const owner = i.business.contactName ?? t('fa15f.owner');
  const agent = (session?.staff.name ?? '').split(/\s+/)[0] ?? '';
  const confirmed = i.result === 'selected' && i.placement;
  const feePercent = i.placement?.feePercent ?? settings.data?.feePercent ?? null;
  const gstPercent = i.placement?.gstPercent ?? settings.data?.gstPercent ?? null;
  const salaryShown = confirmed ? i.placement!.agreedSalaryPaise : salary;
  const fee = confirmed
    ? { fee: i.placement!.feePaise, gst: i.placement!.gstPaise, total: i.placement!.feePaise + i.placement!.gstPaise }
    : salaryShown && feePercent !== null && gstPercent !== null
      ? feeBreakdown(salaryShown, feePercent, gstPercent)
      : null;

  return (
    <>
      <View>
        <Text variant="h2" style={styles.title}>{t('fa15s.title', { name: i.candidate.firstName })}</Text>
        <Text variant="muted">{`${i.business.name} · ${i.vacancy.trade}`}</Text>
      </View>
      {i.result && i.result !== 'selected' ? <Banner tone="info" message={t('fa15f.wasOther')} /> : null}
      <Card title={t('fa15s.step1')}>
        {confirmed ? (
          <>
            <KeyValue label={t('fa15s.salary')} value={formatRupees(i.placement!.agreedSalaryPaise)} strong />
            <KeyValue label={t('fa15s.joining')} value={i.placement!.joiningDate ? formatDayIst(i.placement!.joiningDate) : '—'} strong />
            <KeyValue
              label={t('fa15s.confirmedBy', { owner })}
              last
              trailing={<StatusChip label={i.resultRecordedAt ? formatTimeIst(i.resultRecordedAt) : '✓'} tone="green" />}
              testID="confirmed-by-otp"
            />
          </>
        ) : (
          <View style={styles.gap}>
            <MoneyField label={t('fa15s.salary')} required valuePaise={salary} onChange={setSalary} testID="salary" />
            <DateField label={t('fa15s.joining')} required value={joining} onChange={setJoining} min={todayKeyIst()} testID="joining" />
            {salary && joining ? (
              <OtpStep
                testID="selected-otp"
                sendLabel={t('fa15s.sendOtp', { owner })}
                verifyLabel={t('fa15s.confirm')}
                intro={(s) => t('selling.otpSentTo', { name: s.contactName ?? owner, last4: s.sentToLast4 })}
                send={(prev) => selling.ownerOtp(i.id, { decision: 'selected', salaryPaise: salary, joiningDate: joining, otpRequestId: prev })}
                verify={async (requestId, code) => {
                  await selling.decision(i.id, { decision: 'selected', salaryPaise: salary, joiningDate: joining, otpRequestId: requestId, code });
                  await client.invalidateQueries({ queryKey: queryKeys.sellingInterview(i.id) });
                }}
              />
            ) : (
              <Text variant="muted">{t('fa15s.fillFirst')}</Text>
            )}
          </View>
        )}
      </Card>
      <Card title={t('fa15s.step2')} testID="fee-card">
        {fee && salaryShown ? (
          <>
            <KeyValue label={t('fa15s.feeLine', { percent: feePercent ?? '', salary: formatRupees(salaryShown) })} value={formatRupees(fee.fee)} />
            <KeyValue label={t('fa15s.gstLine', { percent: gstPercent ?? '' })} value={formatRupees(fee.gst)} />
            <KeyValue label={t('fa15s.total')} last trailing={<Text style={styles.total}>{formatRupees(fee.total)}</Text>} testID="fee-total" />
          </>
        ) : (
          <Text variant="muted">{t('fa15s.feeAfterSalary')}</Text>
        )}
        <Text variant="muted" style={styles.note}>{t('fa15s.howPaid', { agent })}</Text>
      </Card>
      {confirmed ? (
        <>
          <Button label={t('fa15s.ownerPaid')} onPress={() => router.push(sellingRoutes.paid(i.placement!.id))} testID="owner-paid" />
          <Note>{t('fa15s.notPaid', { name: i.candidate.firstName })}</Note>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  gap: { gap: 12 },
  title: { fontSize: 17 },
  total: { fontFamily: fonts.display700, color: colors.blue, fontSize: 15 },
  note: { marginTop: 8 },
});
