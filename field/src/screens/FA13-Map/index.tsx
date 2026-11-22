import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, IconTile, ListRow, LoadingState, Screen, StatusChip, Text, TileMap } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { ShopPoint } from '@/api/endpoints';
import { useLocation } from '@/device/location/useLocation';
import { formatCoordinates } from '@/device/location/location';
import { pageRoutes, routes } from '@/navigation/routes';
import { colors, shadow } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { formatDistance } from '../_visits/format';
import { STATUS_COLORS, statusKey } from '../_visits/labels';
import { CloseRevisitButton } from '../_visits/CloseRevisit';
import { revisitStart } from '../_visits/revisitStart';

/**
 * FA13 — Shops near me, inside the Visits tab (redesign, 16 Nov; the Map tab
 * is gone): where the agent is right now (blue dot with accuracy), every
 * business and visited shop around him coloured by status (onboarded,
 * revisit due, interested, not interested), and "Near you" with revisits due
 * first. Markers and rows open the shop: a revisit due of his own starts the
 * visit, a business opens its page (view-only when it is another agent's).
 * Everyone sees every business, so two agents never onboard the same shop.
 * Location is read when the screen opens (an event the agent starts), never
 * in the background. Map tiles: OpenStreetMap, sent with the site address.
 */
export default function MapScreen() {
  const { t } = useI18n();
  const { fieldWork } = useEndpoints();
  const location = useLocation();
  const { read } = location;
  useEffect(() => {
    void read();
  }, [read]);
  const fix = location.fix;
  const q = useQuery({
    queryKey: fix ? queryKeys.fieldMap(fix.latitude, fix.longitude) : ['field-work', 'map', 'none'],
    queryFn: () => fieldWork.map(fix!.latitude, fix!.longitude),
    enabled: Boolean(fix),
  });

  const shops = q.data?.shops ?? [];
  const near = [...shops].sort((a, b) => Number(b.status === 'revisit_due') - Number(a.status === 'revisit_due') || (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0)).slice(0, 8);

  const open = (s: ShopPoint) => {
    const href = shopTarget(s);
    if (href) router.push(href as never);
  };

  return (
    <View style={styles.flex} testID="screen-FA13">
      <AppHeader title={t('fa13.nearMe')} />
      <Screen onRefresh={() => void read()} refreshing={location.loading}>
        <Card compact>
          <View style={styles.row}>
            <IconTile icon="location" accent={fix ? 'royal' : 'navy'} size={32} />
            <Text variant="bodyStrong" style={styles.flex1} testID="fa13-me">
              {fix ? `${t('fa13.youAreHere')} · ${formatCoordinates(fix)}` : location.errorKey ? t(location.errorKey) : t('fa20.gpsFinding')}
            </Text>
            {fix ? <StatusChip tone={fix.level === 'good' ? 'green' : 'amber'} label={t('fa13.accuracy', { meters: Math.round(fix.accuracy) })} /> : null}
          </View>
          {location.errorKey ? <Button label={t('common.retry')} variant="secondary" onPress={() => void read()} /> : null}
        </Card>
        {fix ? (
          <TileMap
            center={fix}
            me={{ latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy }}
            markers={shops.map((s) => ({
              key: s.id,
              latitude: s.latitude,
              longitude: s.longitude,
              color: STATUS_COLORS[s.status] ?? colors.soft,
              // 22 Nov (rev 208): an unregistered shop with a revisit due is its own pin, labelled.
              label: s.status === 'revisit_due' ? `${t('revisit.dueLabel')} · ${s.name}` : s.name,
              onPress: shopTarget(s) ? () => open(s) : undefined,
            }))}
            attribution={t('fa13.attribution')}
            height={380}
            zoom={15}
            testID="fa13-map"
          />
        ) : null}
        <Card compact style={styles.legend}>
          <Legend color={colors.blue} label={t('fa13.you')} />
          {(['onboarded', 'revisit_due', 'interested', 'not_interested'] as const).map((s) => (
            <Legend key={s} color={STATUS_COLORS[s]} label={t(statusKey(s))} />
          ))}
        </Card>
        <Card title={t('fa13.near')} icon="store" accent="gold" testID="fa13-near">
          {!fix ? null : q.isPending ? (
            <LoadingState compact />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
          ) : near.length === 0 ? (
            <EmptyState compact emoji="🗺️" message={t('fa13.noShops')} />
          ) : (
            near.map((s, i) => (
              <View key={s.id}>
              <ListRow
                title={s.name}
                subtitle={[t(statusKey(s.status)), formatDistance(s.distanceMeters)].join(' · ')}
                leading={<View style={[styles.pin, { backgroundColor: STATUS_COLORS[s.status] ?? colors.soft }]} />}
                trailing={
                  s.canAct === false ? (
                    <StatusChip tone="neutral" label={t('biz.viewOnlyShort')} />
                  ) : !shopTarget(s) ? undefined : (
                    <StatusChip tone={isOwnRevisitDue(s) ? 'amber' : 'blue'} label={isOwnRevisitDue(s) ? t('fa13.visit') : t('fa13.open')} />
                  )
                }
                onPress={shopTarget(s) ? () => open(s) : undefined}
                last={i === near.length - 1 || Boolean(s.revisitClosable && s.visitId)}
                testID={`fa13-shop-${s.id}`}
              />
              {s.revisitClosable && s.visitId ? <CloseRevisitButton visitId={s.visitId} name={s.name} testID={`fa13-close-${s.id}`} /> : null}
              </View>
            ))
          )}
        </Card>
      </Screen>
    </View>
  );
}

const isOwnRevisitDue = (s: ShopPoint) => s.status === 'revisit_due' && s.canAct !== false;

/**
 * Where a shop's row and marker open (fix list A4), or null when nothing
 * opens — then the row shows no "Open":
 * - his own revisit that is due: start the visit;
 * - a business: its page (view-only when it is another agent's);
 * - his own unregistered shop (not interested, come back later not yet
 *   due…): the details of his latest visit there;
 * - another agent's unregistered shop: nothing.
 */
export function shopTarget(s: ShopPoint): string | { pathname: string; params: Record<string, string> } | null {
  if (isOwnRevisitDue(s)) return revisitStart({ businessId: s.businessId, visitId: s.visitId, name: s.name, note: s.note, lastVisitAt: s.lastVisitAt });
  if (s.businessId) return pageRoutes.business(s.businessId);
  if (s.visitId && s.canAct !== false) return pageRoutes.visitDetails(s.visitId);
  return null;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="tiny">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pin: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.white, ...shadow.card },
});
