import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { Banner, Button, Card, Screen, Text } from '@/components';
import { useI18n } from '@/i18n';
import { sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { formatRupees, KeyValue, QueryView, useParam } from '../_selling';

/**
 * FA15x — No more matches. Says why (job seekers of this trade within their
 * travel distance; left out by salary and by shift) and keeps the vacancy
 * open; the agent is alerted when a new match registers. Suggests the top
 * salary that would bring the salary ones in — the owner decides.
 */
export default function NoMoreScreen() {
  const { t } = useI18n();
  const vacancyId = useParam('vacancyId');
  const businessId = useParam('businessId');
  const { selling } = useEndpoints();
  const why = useQuery({ queryKey: queryKeys.sellingNoMore(vacancyId), queryFn: () => selling.noMore(vacancyId), enabled: !!vacancyId });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('tabs.jobSeekers')} />
      <Screen testID="screen-FA15x">
        <QueryView query={why}>
          {(w) => (
            <>
              <View>
                <Text variant="h2" style={styles.title}>{t('fa15x.title')}</Text>
                <Text variant="muted">
                  {t('fa15x.sub', { business: w.businessName, trade: w.headcount > 1 ? `${w.trade} × ${w.headcount}` : w.trade, count: w.totalShown })}
                </Text>
              </View>
              <Card title={t('fa15x.why')}>
                <KeyValue label={t('fa15x.within', { trade: w.trade })} value={String(w.withinDistance)} strong testID="within" />
                <KeyValue label={t('fa15x.salaryAbove', { amount: formatRupees(w.vacancyMaxPaise) })} value={String(w.leftOutSalaryAbove)} strong testID="salary-above" />
                <KeyValue label={t('fa15x.shift')} value={String(w.leftOutShift)} strong last testID="shift" />
              </Card>
              <Banner
                tone="info"
                message={`${t('fa15x.staysOpen', { trade: w.trade.toLowerCase() })}${
                  w.raiseToPaise && w.leftOutSalaryAbove > 0 ? ` ${t('fa15x.raise', { amount: formatRupees(w.raiseToPaise), count: w.leftOutSalaryAbove })}` : ''
                }`}
                testID="stays-open"
              />
              <View style={styles.row}>
                <Button
                  label={t('fa15x.change')}
                  variant="secondary"
                  style={styles.flex1}
                  onPress={() => router.push(sellingRoutes.addVacancy(businessId || undefined))}
                  testID="change-vacancy"
                />
                <Button label={t('fa15x.done')} style={styles.flex1} onPress={() => router.back()} testID="done" />
              </View>
            </>
          )}
        </QueryView>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  title: { fontSize: 17 },
});
