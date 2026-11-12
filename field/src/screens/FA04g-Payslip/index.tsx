import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import type { Payslip } from '@/api/endpoints';
import { Banner, Button, Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components';
import { SelectField } from '@/components/form';
import { useI18n, type MessageKey } from '@/i18n';
import { colors, fonts, radius } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { formatRupees, KeyValue } from '../_selling';
import { formatDateKey } from '../_visits/format';

const EARN_KEY: Record<string, MessageKey> = { basic: 'fa04g.basic', hra: 'fa04g.hra', special: 'fa04g.special' };
const STAT_KEY: Record<string, MessageKey> = { pf: 'fa04g.pf', esi: 'fa04g.esi', professional_tax: 'fa04g.pt' };

function hm(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

const dateOf = (iso: string) => formatDateKey(iso.slice(0, 10));

/**
 * FA04g — My payslips (CA14g-Payslip adapted to the phone). The standard
 * corporate payslip, worked out from attendance and approved leave and
 * released by Finance. The server gives only his own, and only once Finance
 * has paid him (GET /payroll/my-payslips and /:month). In the installed web
 * app, "Download PDF" opens the print dialog (Save as PDF).
 */
export default function PayslipScreen() {
  const { t } = useI18n();
  const { myAttendance } = useEndpoints();
  const list = useQuery({ queryKey: queryKeys.myPayslips, queryFn: () => myAttendance.payslips() });
  const months = list.data?.months ?? [];
  const [picked, setPicked] = useState('');
  const month = picked || months[0]?.month || '';
  const slip = useQuery({ queryKey: queryKeys.myPayslip(month), queryFn: () => myAttendance.payslip(month), enabled: Boolean(month) });

  return (
    <View style={styles.flex} testID="screen-FA04g">
      <AppHeader title={t('fa04g.title')} />
      <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
        {list.isPending ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : months.length === 0 ? (
          <EmptyState title={t('fa04g.none')} />
        ) : (
          <>
            <SelectField
              label={t('fa04g.month')}
              value={month}
              onChange={setPicked}
              choices={months.map((m) => ({ value: m.month, label: m.label }))}
              testID="fa04g-month"
            />
            {slip.isPending ? (
              <LoadingState />
            ) : slip.isError ? (
              isApiError(slip.error) && slip.error.status === 404 ? (
                <EmptyState title={t('fa04g.notReleased')} />
              ) : (
                <ErrorState error={slip.error} onRetry={() => void slip.refetch()} />
              )
            ) : (
              <>
                <PayslipCard slip={slip.data} />
                {Platform.OS === 'web' ? (
                  <Button label={t('fa04g.download')} variant="secondary" onPress={() => window.print()} testID="fa04g-download" />
                ) : null}
              </>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}

function PayslipCard({ slip }: { slip: Payslip }) {
  const { t } = useI18n();
  const deductionLabel = (key: string, label: string) => {
    if (key === 'loss_of_pay') return slip.days.lossOfPayDays === 1 ? t('fa04g.lopOne') : t('fa04g.lop', { days: slip.days.lossOfPayDays });
    if (key === 'not_on_staff') return slip.days.notEmployedDays === 1 ? t('fa04g.notOnStaffLineOne') : t('fa04g.notOnStaffLine', { days: slip.days.notEmployedDays });
    if (key === 'shortfall') return t('fa04g.shortfall', { time: hm(slip.days.shortfallMinutes) });
    return STAT_KEY[key] ? t(STAT_KEY[key]) : label;
  };
  return (
    <Card testID="fa04g-slip">
      <View style={styles.head}>
        <Text style={styles.company}>{slip.company.name.toUpperCase()}</Text>
        <Text variant="muted">
          {slip.company.city} · {t('fa04g.for', { month: slip.label })}
        </Text>
        <Text variant="muted">{slip.paidOn ? t('fa04g.paidOn', { date: dateOf(slip.paidOn) }) : t('fa04g.notPaid')}</Text>
      </View>
      <KeyValue label={t('fa04g.name')} value={slip.employee.name} strong />
      <KeyValue label={t('fa04g.employeeId')} value={slip.employee.code} />
      <KeyValue label={t('fa04g.designation')} value={slip.employee.designation} />
      <KeyValue label={t('fa04g.reportsTo')} value={slip.employee.reportsTo ?? t('common.placeholderValue')} />
      <KeyValue label={t('fa04g.joined')} value={slip.employee.joinedOn ? dateOf(slip.employee.joinedOn) : t('common.placeholderValue')} />
      <KeyValue
        label={t('fa04g.paymentRef')}
        value={slip.employee.paymentRefLast4 ? `****${slip.employee.paymentRefLast4}` : t('common.placeholderValue')}
      />
      <KeyValue label={t('fa04g.daysInMonth')} value={String(slip.days.salaryDays)} />
      <KeyValue
        label={t('fa04g.paidDays')}
        value={slip.days.lossOfPayDays > 0 ? t('fa04g.paidDaysLop', { paid: slip.days.paidDays, lop: slip.days.lossOfPayDays }) : String(slip.days.paidDays)}
        last={slip.days.notEmployedDays === 0}
      />
      {slip.days.notEmployedDays > 0 ? (
        <KeyValue label={t('fa04g.notOnStaff')} value={t('fa04g.notOnStaffDays', { days: slip.days.notEmployedDays })} last />
      ) : null}

      <Text variant="label" style={styles.section}>
        {t('fa04g.earnings')}
      </Text>
      {slip.earnings.map((e) => (
        <KeyValue key={e.key} label={EARN_KEY[e.key] ? t(EARN_KEY[e.key]) : e.label} value={formatRupees(e.paise)} />
      ))}
      <KeyValue label={t('fa04g.gross')} value={formatRupees(slip.grossPaise)} strong last testID="fa04g-gross" />

      <Text variant="label" style={styles.section}>
        {t('fa04g.deductions')}
      </Text>
      {slip.deductions.map((d) => (
        <KeyValue key={d.key} label={deductionLabel(d.key, d.label)} value={d.note && d.paise === 0 ? t('fa04g.afterRegistration') : formatRupees(d.paise)} />
      ))}
      <KeyValue label={t('fa04g.total')} value={formatRupees(slip.deductionsPaise)} strong last={!slip.correction?.paise && (slip.carryForwardPaise ?? 0) >= 0} />
      {slip.correction && slip.correction.paise !== 0 ? (
        <KeyValue
          label={t('fa04g.correction')}
          value={`${slip.correction.paise > 0 ? '+ ' : ''}${formatRupees(slip.correction.paise)}`}
          last={(slip.carryForwardPaise ?? 0) >= 0}
        />
      ) : null}
      {(slip.carryForwardPaise ?? 0) < 0 ? <KeyValue label={t('fa04g.carryForward')} value={formatRupees(-(slip.carryForwardPaise ?? 0))} last /> : null}

      <View style={styles.net} testID="fa04g-net">
        <Text style={styles.netLabel}>{t('fa04g.net')}</Text>
        <Text style={styles.netValue}>{formatRupees(slip.netPaise)}</Text>
        <Text style={styles.netWords}>{slip.netInWords}</Text>
      </View>
      <Banner tone="warn" message={t('fa04g.note')} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  head: { borderBottomWidth: 2, borderBottomColor: colors.navy, paddingBottom: 10, marginBottom: 4, gap: 2 },
  company: { fontFamily: fonts.display700, color: colors.navy, fontSize: 16 },
  section: { marginTop: 14, marginBottom: 2 },
  net: {
    marginTop: 14,
    marginBottom: 12,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.green,
    backgroundColor: colors.green100,
    gap: 2,
  },
  netLabel: { fontFamily: fonts.body700, color: colors.green, fontSize: 13.5 },
  netValue: { fontFamily: fonts.display700, color: colors.green, fontSize: 22 },
  netWords: { fontFamily: fonts.body600, color: colors.green, fontSize: 12.5 },
});
