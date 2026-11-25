import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, Icon, IconTile, ListRow, LoadingState, Screen, StatusChip } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { FieldNotification, FieldNotificationTarget } from '@/api/endpoints';
import { formatStampIst } from '@/lib/format';
import { pageRoutes, routes, sellingRoutes, sellingRoutesFor } from '@/navigation/routes';
import { AppHeader } from '../_shared/AppHeader';

type Href = string | { pathname: string; params: Record<string, string> };

/** Where a notification opens in Laboura Field: the record it is about. */
export function notificationHref(target: FieldNotificationTarget | null): Href | null {
  if (!target) return null;
  switch (target.type) {
    case 'visit_assignment':
      // 21 Nov review: the visit itself — a verification opens its steps, an interview to attend its day screen.
      if (target.open && (target.purpose === 'verification' || target.purpose === 'business_signup' || target.purpose === 'candidate_report') && target.businessId) {
        return { pathname: routes.visitVerify, params: { businessId: target.businessId, assignmentId: target.id } };
      }
      if (target.open && target.interviewId) return sellingRoutesFor('/visit').interviewDay(target.interviewId);
      return routes.visits;
    case 'business':
      return pageRoutes.business(target.id);
    case 'placement':
      return sellingRoutes.joining(target.id);
    case 'revisit':
      return { pathname: routes.visitStart, params: { revisitOf: target.id } };
    case 'vacancy_matches':
      return target.businessId && target.vacancyId ? sellingRoutes.matches(target.businessId, target.vacancyId) : null;
    case 'job_seeker':
      return pageRoutes.seekerProfile(target.id);
    case 'referral':
      return pageRoutes.referralSaved(target.id);
    case 'leave':
      return routes.myLeave;
    case 'correction':
      return routes.myCorrection;
    case 'payslip':
      return routes.myPayslips;
    default:
      return null;
  }
}

/**
 * FA25 — Notifications, the bell (owner approved 17 Nov; built 21 Nov): every
 * notification for the agent, newest first — visits assigned or moved to
 * him, new matches, agreements signed, work handed over, leave and
 * correction decisions — each opening its record, unread ones marked; tapping
 * one marks it read, and "Mark all as read". Data: GET /field-work/notifications,
 * POST /notifications/:id/seen, POST /notifications/seen.
 */
export default function NotificationsScreen() {
  const { t } = useI18n();
  const { fieldOps } = useEndpoints();
  const client = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.notifications, queryFn: () => fieldOps.notifications() });
  const refresh = () => void client.invalidateQueries({ queryKey: queryKeys.notifications });
  const markOne = useMutation({ mutationFn: (id: string) => fieldOps.markSeen(id), onSettled: refresh });
  const markAll = useMutation({ mutationFn: () => fieldOps.markAllSeen(), onSettled: refresh });

  function open(n: FieldNotification) {
    if (!n.seenAt) markOne.mutate(n.id);
    const href = notificationHref(n.target);
    if (href) router.push(href as never);
  }

  return (
    <View style={styles.flex} testID="screen-FA25">
      <AppHeader title={t('bell.title')} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        {q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            {q.data.unseenCount > 0 ? (
              <Button label={t('bell.markAll')} variant="secondary" loading={markAll.isPending} onPress={() => markAll.mutate()} testID="bell-mark-all" />
            ) : null}
            <Card testID="bell-list">
              {q.data.items.length === 0 ? <EmptyState compact emoji="🔔" message={t('bell.empty')} /> : null}
              {q.data.items.map((n, i) => (
                <ListRow
                  key={n.id}
                  title={n.title}
                  subtitle={[n.body, formatStampIst(n.createdAt)].filter(Boolean).join(' · ')}
                  leading={<IconTile icon="bell" accent={n.seenAt ? 'navy' : 'orange'} size={34} />}
                  trailing={n.seenAt ? <Icon name="chevron-right" size={16} /> : <StatusChip tone="amber" label={t('bell.unread')} />}
                  onPress={() => open(n)}
                  last={i === q.data.items.length - 1}
                  testID={`bell-${n.id}`}
                />
              ))}
            </Card>
          </>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
