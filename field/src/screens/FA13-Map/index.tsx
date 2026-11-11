import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Button, Card, EmptyState, ErrorState, Icon, ListRow, LoadingState, Screen, StatusChip, Text, TileMap } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { ShopPoint } from '@/api/endpoints';
import { useLocation } from '@/device/location/useLocation';
import { formatCoordinates } from '@/device/location/location';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { formatDistance } from '../_visits/format';
import { STATUS_COLORS, statusKey } from '../_visits/labels';

/**
 * FA13 — Map: where the agent is right now (blue dot with accuracy), every
 * business and visited shop around him coloured by status (onboarded,
 * revisit due, interested, not interested), and "Near you" with revisits due
 * first. Everyone sees every business, so two agents never onboard the same
 * shop. Location is read when the map opens (an event the agent starts),
 * never in the background. Map tiles: OpenStreetMap.
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

  function open(s: ShopPoint) {
    if (s.status === 'revisit_due') {
      router.push({ pathname: routes.visitStart, params: s.businessId ? { businessId: s.businessId, name: s.name } : { revisitOf: s.visitId ?? '', name: s.name } });
    } else if (s.businessId) {
      router.push(`${routes.business}/${s.businessId}`);
    }
  }

  return (
    <View style={styles.flex} testID="screen-FA13">
      <AppHeader title={t('fa13.title')} />
      <Screen onRefresh={() => void read()} refreshing={location.loading}>
        <Card compact>
          <View style={styles.row}>
            <Icon name="location" color={colors.blue} />
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
            markers={shops.map((s) => ({ key: s.id, latitude: s.latitude, longitude: s.longitude, color: STATUS_COLORS[s.status] ?? colors.soft, label: s.name }))}
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
        <Card title={t('fa13.near')} testID="fa13-near">
          {!fix ? null : q.isPending ? (
            <LoadingState compact />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
          ) : near.length === 0 ? (
            <EmptyState compact message={t('fa13.noShops')} />
          ) : (
            near.map((s, i) => (
              <ListRow
                key={s.id}
                title={s.name}
                subtitle={[t(statusKey(s.status)), formatDistance(s.distanceMeters)].join(' · ')}
                trailing={<StatusChip tone={s.status === 'revisit_due' ? 'amber' : 'blue'} label={s.status === 'revisit_due' ? t('fa13.visit') : t('fa13.open')} />}
                onPress={() => open(s)}
                last={i === near.length - 1}
                testID={`fa13-shop-${s.id}`}
              />
            ))
          )}
        </Card>
      </Screen>
    </View>
  );
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
});
