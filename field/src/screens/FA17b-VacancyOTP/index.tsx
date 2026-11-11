import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { Banner, Button, Card, Screen, Text } from '@/components';
import { formatDateKey } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { formatTimeIst } from '@/lib/format';
import { sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner, formatRupees, Note, QueryView, SHIFT_KEYS, useParam } from '../_selling';
import { OtpStep } from '../_selling/OtpStep';
import { roleKey } from '../FA18-CallOwner';

/**
 * FA17b — the contact person confirms the vacancy by OTP, so no vacancy is
 * invented. He gets the details by SMS with the code and reads it out; owner
 * not here → a confirmation link by SMS, the vacancy stays "waiting" until
 * then. Confirmed → Show matching candidates.
 */
export default function VacancyOtpScreen() {
  const { t } = useI18n();
  const id = useParam('id');
  const otpParam = useParam('otp');
  const last4Param = useParam('last4');
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const vacancy = useQuery({
    queryKey: ['selling', 'vacancy', id],
    queryFn: async () => {
      const raw = await selling.vacancy(id);
      const business = await selling.business(raw.businessId);
      return { business, row: business.vacancies.find((v) => v.id === id) ?? null, status: raw.status, confirmedAt: raw.confirmedAt, confirmedByName: raw.confirmedByName };
    },
    enabled: !!id,
  });
  const link = useMutation({ mutationFn: () => queue.live(() => selling.vacancyLink(id)) });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa17b.subtitle')} />
      <Screen testID="screen-FA17b">
        <QueryView query={vacancy}>
          {({ business, row, status, confirmedAt, confirmedByName }) => {
            const contact = row?.contactName ?? business.contactName ?? t('fa15f.owner');
            const role = row?.contactRole ?? business.contactRole ?? 'owner';
            const last4 = row?.contactPhoneLast4 ?? business.contactPhoneLast4;
            const details = row
              ? [
                `${business.name} · ${row.headcount > 1 ? `${row.trade} × ${row.headcount}` : row.trade}`,
                row.salaryMinPaise ? `${formatRupees(row.salaryMinPaise)}${row.salaryMaxPaise ? `–${formatRupees(row.salaryMaxPaise).replace('₹', '')}` : ''}` : null,
                row.shift && SHIFT_KEYS[row.shift] ? t('fa17b.shiftLabel', { shift: t(SHIFT_KEYS[row.shift]) }) : null,
                row.startDate ? t('fa17b.from', { date: formatDateKey(String(row.startDate).slice(0, 10)) }) : null,
              ].filter(Boolean).join(' · ')
              : business.name;
            const confirmed = status === 'open';
            return (
              <>
                <View>
                  <Text variant="h2" style={styles.title}>{t('fa17b.title')}</Text>
                  <Text variant="muted">{details}</Text>
                </View>
                {confirmed ? (
                  <Banner
                    tone="ok"
                    title={t('fa17b.confirmed', { name: confirmedByName ?? contact, time: confirmedAt ? formatTimeIst(confirmedAt) : '' })}
                    testID="vacancy-confirmed"
                  />
                ) : (
                  <Card>
                    <OtpStep
                      testID="vacancy-otp"
                      initial={otpParam ? { otpRequestId: otpParam, sentToLast4: last4Param || last4, contactName: contact } : null}
                      sendLabel={t('fa17b.send', { name: contact })}
                      verifyLabel={t('fa17b.verify')}
                      intro={(s) => t('fa17b.sent', { name: s.contactName ?? contact, role: t(roleKey(role)), last4: s.sentToLast4 })}
                      send={(prev) => selling.sendVacancyCode(id, prev)}
                      verify={async (requestId, code) => {
                        await selling.confirmVacancy(id, requestId, code);
                        await client.invalidateQueries({ queryKey: ['selling'] });
                      }}
                    />
                    <Note>{t('fa17b.notHere')}</Note>
                    <Button
                      label={link.isSuccess ? t('fa17b.linkSent', { last4: link.data.sentToLast4 }) : t('fa17b.sendLink')}
                      variant="secondary"
                      disabled={link.isSuccess}
                      loading={link.isPending}
                      onPress={() => link.mutate()}
                      testID="send-link"
                    />
                    <ErrorBanner error={link.error} />
                  </Card>
                )}
                <Button
                  label={t('fa17b.showMatches')}
                  disabled={!confirmed}
                  onPress={() => router.replace(sellingRoutes.matches(business.id, id))}
                  testID="show-matches"
                />
              </>
            );
          }}
        </QueryView>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 17 },
});
