import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, Icon, Screen, StatusChip, Text } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import { useOfflineQueue } from '@/device/offline-queue';
import { useLocation } from '@/device/location/useLocation';
import { formatCoordinates } from '@/device/location/location';
import type { CapturedPhoto } from '@/device/camera';
import { formatStampIst } from '@/lib/format';
import { newId } from '@/lib/uuid';
import { routes } from '@/navigation/routes';
import { colors, radius } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { CameraSheet } from '../_visits/CameraSheet';
import { StepHeader } from '../_visits/StepHeader';
import { formatDistance } from '../_visits/format';
import { photoRequest } from '../_visits/photo';
import { saveDraft } from '../_visits/visitDraft';
import { visitPaths, type ShopPoint } from '@/api/endpoints';
import { statusKey } from '../_visits/labels';

/**
 * FA20 — Visit a shop, step 1 (outside, before going in). GPS is read, the
 * agent takes a live photo of the shop with its name board (camera only,
 * stamped with time and place; a photo used before is refused by the
 * server), and the visit timer starts. Shops already in Laboura within the
 * duplicate radius are offered: picking one records this as a revisit.
 * The photo goes through the offline queue (Idempotency-Key).
 */
export default function VisitStartScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ businessId?: string; revisitOf?: string; name?: string }>();
  const { fieldWork } = useEndpoints();
  const queue = useOfflineQueue();
  const location = useLocation();
  const { read } = location;
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sameShop, setSameShop] = useState<ShopPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    void read();
  }, [read]);

  const fix = location.fix;
  const nearby = useQuery({
    queryKey: fix ? [...queryKeys.fieldMap(fix.latitude, fix.longitude), 'nearby'] : ['field-work', 'map', 'none'],
    queryFn: () => fieldWork.map(fix!.latitude, fix!.longitude, 150),
    enabled: Boolean(fix) && !params.businessId && !params.revisitOf,
  });
  const close = (nearby.data?.shops ?? []).filter((s) => (s.distanceMeters ?? 0) <= (nearby.data?.duplicateRadiusMeters ?? 50) * 2);
  const suggestion = close[0] ?? null;

  async function onPhoto(photo: CapturedPhoto) {
    setError(null);
    setBusy(true);
    const id = newId();
    const businessId = params.businessId ?? sameShop?.businessId ?? undefined;
    const revisitOf = params.revisitOf ?? (sameShop && !sameShop.businessId ? sameShop.visitId ?? undefined : undefined);
    const fields: Record<string, string> = { id };
    if (businessId) fields.businessId = businessId;
    if (revisitOf) fields.revisitOfVisitId = revisitOf;
    const name = params.name ?? sameShop?.name ?? '';
    try {
      await queue.submit(`${t('fa20.queueLabel')}${name ? ` · ${name}` : ''}`, photoRequest(visitPaths.start, photo, fields, 'shop.jpg'));
      saveDraft({
        id,
        startedAt: photo.stamp.takenAt,
        latitude: photo.stamp.latitude ?? fix?.latitude ?? 0,
        longitude: photo.stamp.longitude ?? fix?.longitude ?? 0,
        accuracy: photo.stamp.accuracy,
        shopName: name,
        businessId: businessId ?? null,
        businessName: businessId ? name : null,
        spokeTo: '',
        contactPhone: '',
        endedAt: null,
        proofDistance: null,
        proofAt: null,
      });
      router.replace({ pathname: routes.visitTalk, params: { id } });
    } catch (e) {
      setError(isApiError(e) ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.flex} testID="screen-FA20">
      <AppHeader title={t('fa20.title')} />
      <Screen>
        <StepHeader step={1} label={t('fa20.step')} />
        {!queue.online ? <Banner tone="info" message={t('common.offline')} /> : null}
        <Card title={t('fa20.photoTitle')}>
          <View style={styles.gps} testID="fa20-gps">
            <Icon name="location" color={fix ? colors.green : colors.soft} />
            <Text variant="small" style={styles.flex1}>
              {fix ? `${t('fa20.gpsFound')} · ${formatCoordinates(fix)}` : location.errorKey ? t(location.errorKey) : t('fa20.gpsFinding')}
            </Text>
            {fix ? <StatusChip tone={fix.level === 'good' ? 'green' : 'amber'} label={t('device.location.accuracy', { meters: Math.round(fix.accuracy) })} /> : null}
          </View>
          {location.errorKey ? <Button label={t('common.retry')} variant="secondary" onPress={() => void read()} /> : null}
          <View style={styles.photoBox}>
            <Icon name="camera" size={34} color={colors.white} />
            <Text variant="h2" align="center" color={colors.white}>
              {t('fa20.pointAt')}
            </Text>
            <Text variant="small" align="center" color={colors.navSoft}>
              {t('fa20.cameraOnly')}
            </Text>
            {fix ? (
              <Text variant="tiny" align="center" color={colors.navSoft}>
                {`${formatCoordinates(fix)} · ${formatStampIst(openedAt)}`}
              </Text>
            ) : null}
          </View>
          {params.name ? <Text variant="small">{t('fa20.visiting', { name: params.name })}</Text> : null}
        </Card>

        {suggestion ? (
          <Banner
            tone="warn"
            title={t('fa20.nearby', {
              name: suggestion.name,
              distance: formatDistance(suggestion.distanceMeters),
              status: t(statusKey(suggestion.status)),
            })}
            message={t('fa20.nearbyHint')}
            testID="fa20-nearby"
            action={
              <Button
                label={sameShop?.id === suggestion.id ? t('fa20.isThatShop') : t('fa20.markThatShop')}
                variant={sameShop?.id === suggestion.id ? 'success' : 'secondary'}
                onPress={() => setSameShop(sameShop?.id === suggestion.id ? null : suggestion)}
                testID="fa20-same-shop"
              />
            }
          />
        ) : null}
        {error ? <Banner tone="error" message={error} testID="fa20-error" /> : null}
        <Button
          label={t('fa20.takePhoto')}
          icon={<Icon name="camera" color={colors.white} />}
          loading={busy}
          onPress={() => setCameraOpen(true)}
          testID="fa20-take-photo"
        />
      </Screen>
      <CameraSheet open={cameraOpen} facing="back" label={params.name} onCapture={(p) => void onPhoto(p)} onClose={() => setCameraOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  gps: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, padding: 10, borderRadius: radius.md, backgroundColor: colors.green100 },
  photoBox: {
    alignItems: 'center',
    gap: 6,
    padding: 18,
    paddingVertical: 48,
    borderRadius: radius.card,
    backgroundColor: colors.navy,
  },
});
