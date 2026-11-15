import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, Icon, IconTile, ListRow, LoadingState, Screen, StatusChip } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { FieldVisits } from '@/api/endpoints';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { formatDateKey, minutesOf } from '../_visits/format';
import { outcomeKey } from '../_visits/labels';

/**
 * FA05 — My visits: planned visits (verification visits, app sign-up visits
 * for businesses that signed up in the Laboura app, and interviews to attend), revisits that are due, and every visit done today with its proof
 * (📷 board photo, + selfie), time and outcome. A visit still missing its
 * outcome or proof opens the step that is left. Data: GET /field-work/visits.
 */
export default function VisitsScreen() {
  const { t } = useI18n();
  const { fieldWork } = useEndpoints();
  const q = useQuery<FieldVisits>({ queryKey: queryKeys.fieldVisits, queryFn: () => fieldWork.visits() });

  return (
    <View style={styles.flex} testID="screen-FA05">
      <AppHeader title={t('fa05.title')} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        <Button
          label={t('fa03.visitShop')}
          icon={<Icon name="camera" color={colors.white} />}
          onPress={() => router.push(routes.visitStart)}
          testID="fa05-visit-shop"
        />
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <Card title={t('fa05.planned')} icon="calendar" accent="royal" testID="fa05-planned">
              {q.data.planned.length === 0 ? <EmptyState compact emoji="🗓️" message={t('fa05.noPlanned')} /> : null}
              {q.data.planned.map((p, i) => {
                // An app sign-up's visit (business_signup) is its verification visit: the same steps.
                const verify = p.purpose === 'verification' || p.purpose === 'business_signup';
                const signup = p.purpose === 'business_signup';
                return (
                  <ListRow
                    key={p.assignmentId}
                    title={p.business.name}
                    leading={<IconTile icon={signup ? 'user-plus' : verify ? 'shield' : 'users'} accent={signup ? 'green' : verify ? 'royal' : 'cyan'} size={34} />}
                    subtitle={
                      p.interview
                        ? `${formatDayIst(p.interview.startsAt)} ${formatTimeIst(p.interview.startsAt)} · ${p.interview.candidateName}`
                        : [
                            signup && p.requestedFor
                              ? t('fa05.ownerPicked', { when: `${formatDayIst(p.requestedFor)} ${formatTimeIst(p.requestedFor)}` })
                              : null,
                            p.business.locality,
                            p.business.code,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                    }
                    trailing={
                      <StatusChip
                        tone={signup ? 'green' : verify ? 'blue' : 'cyan'}
                        label={signup ? t('fa05.signupVisit') : verify ? t('fa05.verification') : t('fa05.attendInterview')}
                      />
                    }
                    onPress={() =>
                      verify
                        ? router.push({ pathname: routes.visitVerify, params: { businessId: p.business.id, assignmentId: p.assignmentId } })
                        : router.push(`${routes.business}/${p.business.id}`)
                    }
                    last={i === q.data.planned.length - 1}
                    testID={`fa05-planned-${p.assignmentId}`}
                  />
                );
              })}
            </Card>

            <Card title={t('fa05.revisits')} icon="store" accent="gold" testID="fa05-revisits">
              {q.data.revisitsDue.length === 0 ? <EmptyState compact emoji="🏪" message={t('fa05.noRevisits')} /> : null}
              {q.data.revisitsDue.map((r, i) => (
                <ListRow
                  key={r.visitId}
                  title={r.name}
                  leading={<IconTile icon={r.when === 'overdue' ? 'alert' : 'clock'} accent={r.when === 'overdue' ? 'red' : 'gold'} size={34} />}
                  subtitle={r.note ? t('fa05.ownerSaid', { note: r.note }) : r.locality ?? undefined}
                  trailing={
                    <StatusChip
                      tone={r.when === 'overdue' ? 'tomato' : 'amber'}
                      label={r.when === 'overdue' && r.revisitOn ? t('fa05.overdueSince', { date: formatDateKey(r.revisitOn) }) : t('fa05.comeBackToday')}
                    />
                  }
                  onPress={() =>
                    router.push({
                      pathname: routes.visitStart,
                      params: r.businessId ? { businessId: r.businessId, name: r.name } : { revisitOf: r.visitId, name: r.name },
                    })
                  }
                  last={i === q.data.revisitsDue.length - 1}
                  testID={`fa05-revisit-${r.visitId}`}
                />
              ))}
            </Card>

            <Card title={t('fa05.done')} icon="check-circle" accent="green" testID="fa05-done">
              {q.data.doneToday.length === 0 ? <EmptyState compact emoji="👟" message={t('fa05.noDone')} /> : null}
              {q.data.doneToday.map((v, i) => {
                const minutes = minutesOf(v.durationSeconds);
                const proof = [v.hasBoardPhoto ? '📷' : null, v.hasSelfie ? t('fa05.plusSelfie') : null].filter(Boolean).join(' ');
                const subtitle = [formatTimeIst(v.startedAt), minutes !== null ? t('common.minutes', { minutes }) : null, proof || null]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <ListRow
                    key={v.id}
                    title={v.name ?? t('fa05.unnamedShop')}
                    leading={<DoneTile visit={v} />}
                    subtitle={subtitle}
                    trailing={
                      v.needsProof ? (
                        <StatusChip tone="amber" label={t('fa05.proofNeeded')} />
                      ) : v.needsOutcome ? (
                        <StatusChip tone="amber" label={t('fa05.outcomeNeeded')} />
                      ) : (
                        <StatusChip tone={v.outcome === 'onboarded' ? 'green' : v.outcome === 'not_interested' ? 'crit' : v.outcome === 'owner_not_there' ? 'amber' : 'cyan'} label={t(outcomeKey(v.outcome))} />
                      )
                    }
                    onPress={() =>
                      v.needsProof
                        ? router.push({ pathname: routes.visitProof, params: { id: v.id } })
                        : v.needsOutcome
                          ? router.push({ pathname: routes.visitOutcome, params: { id: v.id } })
                          : v.business
                            ? router.push(`${routes.business}/${v.business.id}`)
                            : undefined
                    }
                    last={i === q.data.doneToday.length - 1}
                    testID={`fa05-done-${v.id}`}
                  />
                );
              })}
            </Card>
          </>
        )}
      </Screen>
    </View>
  );
}

/** The coloured tile beside a visit done today: what is left to do, or how it went. */
function DoneTile({ visit: v }: { visit: FieldVisits['doneToday'][number] }) {
  if (v.needsProof) return <IconTile icon="camera" accent="gold" size={34} />;
  if (v.needsOutcome) return <IconTile icon="clipboard" accent="gold" size={34} />;
  if (v.outcome === 'onboarded') return <IconTile icon="check-circle" accent="green" size={34} />;
  if (v.outcome === 'not_interested') return <IconTile icon="x-circle" accent="orange" size={34} />;
  if (v.outcome === 'owner_not_there') return <IconTile icon="clock" accent="navy" size={34} />;
  return <IconTile icon="star" accent="cyan" size={34} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
