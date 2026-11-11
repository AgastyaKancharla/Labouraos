import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, ListRow, LoadingState, Screen, StatusChip, Text } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { istDateKey, minutesOf, salaryRange } from '../_visits/format';
import { outcomeKey, verificationKey } from '../_visits/labels';

/**
 * FA08 — Business page: status, contact person (number masked) and branches,
 * open vacancies with their OTP confirmation, results with Laboura, and the
 * visit history with photos and times. Contact details are shown only to the
 * account agent (guide: field agents see full details of their own
 * businesses). Data: GET /field-work/businesses/:id.
 */
export default function BusinessScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { fieldWork } = useEndpoints();
  const [today] = useState(() => istDateKey(Date.now()));
  const q = useQuery({ queryKey: queryKeys.fieldBusiness(id ?? ''), queryFn: () => fieldWork.business(id!), enabled: Boolean(id) });
  if (!id) return <EmptyState message={t('common.error')} />;

  return (
    <View style={styles.flex} testID="screen-FA08">
      <AppHeader title={t('fa08.title')} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          (() => {
            const b = q.data;
            return (
              <>
                <Card>
                  <View style={styles.head}>
                    <View style={styles.flex1}>
                      <Text variant="h1">{b.name}</Text>
                      <Text variant="muted">
                        {[b.businessType ? t(`btype.${b.businessType}` as 'btype.other') : null, b.locality, b.code, b.isMine ? t('fa08.yourAccount') : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    <StatusChip tone={b.verificationStatus === 'verified' && !b.paused ? 'green' : 'amber'} label={t(verificationKey(b.verificationStatus, b.paused))} />
                  </View>
                  <View style={styles.actions}>
                    <Button label={t('fa08.showCandidates')} disabled={!b.canShowCandidates} style={styles.cell} onPress={() => router.push({ pathname: routes.jobSeekers, params: { businessId: b.id } })} testID="fa08-show" />
                    <Button label={t('fa03.addVacancy')} variant="secondary" style={styles.cell} onPress={() => router.push({ pathname: routes.vacancyNew, params: { businessId: b.id } })} testID="fa08-vacancy" />
                    <Button label={t('fa08.callOwner')} variant="secondary" style={styles.cell} disabled={!b.isMine} onPress={() => router.push({ pathname: routes.callOwner, params: { businessId: b.id } })} testID="fa08-call" />
                    <Button label={t('fa08.recordVisit')} variant="secondary" style={styles.cell} onPress={() => router.push({ pathname: routes.visitStart, params: { businessId: b.id, name: b.name } })} testID="fa08-visit" />
                  </View>
                </Card>

                <Card title={t('fa08.contact')}>
                  {b.contact ? (
                    <ListRow
                      title={[b.contact.name, b.contact.role ? t(`role.${b.contact.role}` as 'role.owner') : null].filter(Boolean).join(' · ')}
                      trailing={<Text variant="bodyStrong">{b.contact.phone}</Text>}
                      last={b.branches.length === 0}
                      testID="fa08-contact"
                    />
                  ) : (
                    <Text variant="muted" testID="fa08-not-yours">{t('fa08.notYours')}</Text>
                  )}
                  {b.branches.length > 0 ? (
                    <ListRow
                      title={t('fa08.branches')}
                      subtitle={b.branches.map((br) => `${br.locality ?? br.name} · ${br.contactPersonName} (${t(`role.${br.contactPersonRole}` as 'role.owner')})`).join('\n')}
                      last
                    />
                  ) : null}
                </Card>

                <Card title={t('fa08.openVacancies')}>
                  {b.vacancies.length === 0 ? <EmptyState compact message={t('fa08.noVacancies')} /> : null}
                  {b.vacancies.map((v, i) => (
                    <ListRow
                      key={v.id}
                      title={`${v.trade} × ${v.headcount}`}
                      subtitle={[salaryRange(v.salaryMinPaise, v.salaryMaxPaise), v.otpConfirmed ? t('fa08.otpConfirmed') : t('fa08.otpWaiting')].filter(Boolean).join(' · ')}
                      trailing={v.otpConfirmed ? <StatusChip tone="blue" label={t('fa08.matches')} /> : <StatusChip tone="amber" label={t('fa08.otpWaiting')} />}
                      onPress={v.otpConfirmed ? () => router.push({ pathname: routes.jobSeekers, params: { businessId: b.id, vacancyId: v.id } }) : undefined}
                      last={i === b.vacancies.length - 1}
                    />
                  ))}
                </Card>

                <Card title={t('fa08.withLaboura')}>
                  <ListRow title={t('fa08.shown')} trailing={<Text variant="bodyStrong">{String(b.stats.candidatesShown)}</Text>} />
                  <ListRow title={t('fa08.interviews')} trailing={<Text variant="bodyStrong">{String(b.stats.interviews)}</Text>} />
                  <ListRow
                    title={t('fa08.placements')}
                    trailing={
                      <Text variant="bodyStrong">
                        {b.stats.inGuarantee > 0 ? `${b.stats.placements} · ${t('fa08.inGuarantee', { count: b.stats.inGuarantee })}` : String(b.stats.placements)}
                      </Text>
                    }
                    last
                  />
                </Card>

                <Card title={t('fa08.visitHistory')} testID="fa08-visits">
                  {b.visits.length === 0 ? <EmptyState compact message={t('fa08.noVisits')} /> : null}
                  {b.visits.map((v, i) => {
                    const m = minutesOf(v.durationSeconds);
                    const when = istDateKey(v.at) === today ? `${t('date.today')} ${formatTimeIst(v.at)}` : formatDayIst(v.at);
                    const proof = [v.hasBoardPhoto ? '📷' : null, v.hasSelfie ? t('fa05.plusSelfie') : null].filter(Boolean).join(' ');
                    return (
                      <ListRow
                        key={v.id}
                        title={[when, m !== null ? t('common.minutes', { minutes: m }) : null, proof || null].filter(Boolean).join(' · ')}
                        subtitle={v.staffName ?? undefined}
                        trailing={<StatusChip tone={v.outcome === 'onboarded' ? 'green' : v.outcome ? 'cyan' : 'amber'} label={t(outcomeKey(v.outcome))} />}
                        last={i === b.visits.length - 1}
                      />
                    );
                  })}
                </Card>
              </>
            );
          })()
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  head: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  cell: { flexBasis: '48%', flexGrow: 1 },
});
