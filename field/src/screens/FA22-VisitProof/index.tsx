import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, IconTile, ListRow, LoadingState, Screen, StatusChip, Text } from '@/components';
import { isApiError } from '@/api/errors';
import { visitPaths } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { distanceMeters, formatCoordinates } from '@/device/location/location';
import type { CapturedPhoto } from '@/device/camera';
import { formatStampIst } from '@/lib/format';
import { pageRoutes, routes } from '@/navigation/routes';
import { colors, heroGradient, radius } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { CameraSheet } from '../_visits/CameraSheet';
import { StepHeader } from '../_visits/StepHeader';
import { minutesOf } from '../_visits/format';
import { photoRequest } from '../_visits/photo';
import { useVisit } from '../_visits/useVisit';
import { updateDraft } from '../_visits/visitDraft';

/** The design's "same spot" line: the proof selfie must be this close to the board photo (server checks too). */
export const SAME_SPOT_METERS = 100;

/**
 * FA22 — Visit a shop, step 3 (proof before onboarding). For an interested
 * shop the agent steps out and takes a selfie with the name board behind
 * him (front camera, live only). GPS is checked again against the shop
 * photo and the time at the shop is shown. Only then does registration open.
 */
export default function VisitProofScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { visit, server, loading, error } = useVisit(id);
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [selfie, setSelfie] = useState<CapturedPhoto | null>(null);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openedAt] = useState(() => Date.now());

  if (!id) return <EmptyState message={t('common.error')} />;
  if (loading) return <LoadingState />;
  if (!visit) return <ErrorState error={error} onRetry={() => router.replace(routes.visits)} />;

  const done = sent || Boolean(server?.hasSelfie);
  const gap =
    selfie && selfie.stamp.latitude !== null && selfie.stamp.longitude !== null
      ? Math.round(distanceMeters(visit, { latitude: selfie.stamp.latitude, longitude: selfie.stamp.longitude }))
      : (visit.proofDistance ?? null);
  const tooFar = gap !== null && gap > SAME_SPOT_METERS;
  const end = visit.endedAt ? new Date(visit.endedAt).getTime() : selfie ? new Date(selfie.stamp.takenAt).getTime() : openedAt;
  const minutes = minutesOf((end - new Date(visit.startedAt).getTime()) / 1000) ?? 0;

  async function onSelfie(photo: CapturedPhoto) {
    setSelfie(photo);
    setProblem(null);
    const distance =
      photo.stamp.latitude !== null && photo.stamp.longitude !== null
        ? distanceMeters(visit!, { latitude: photo.stamp.latitude, longitude: photo.stamp.longitude })
        : null;
    if (distance !== null && distance > SAME_SPOT_METERS) {
      setProblem(t('fa22.tooFar', { meters: Math.round(distance) }));
      return;
    }
    setBusy(true);
    try {
      await queue.submit(`${t('fa22.queueLabel')} · ${visit!.shopName}`, photoRequest(visitPaths.proof(visit!.id), photo, {}, 'selfie.jpg'));
      updateDraft(visit!.id, { proofDistance: distance === null ? null : Math.round(distance), proofAt: photo.stamp.takenAt });
      setSent(true);
      void client.invalidateQueries({ queryKey: ['field-work'] });
    } catch (e) {
      setProblem(isApiError(e) ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.flex} testID="screen-FA22">
      <AppHeader title={t('fa20.title')} />
      <Screen>
        <StepHeader step={3} />
        <Card title={t('fa22.selfieTitle')} icon="user" accent="green">
          <LinearGradient colors={done ? doneGradient : heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.photoBox}>
            <IconTile icon={done ? 'check' : 'camera'} accent={done ? 'green' : 'cyan'} size={60} />
            <Text variant="h2" align="center" color={colors.white}>
              {t('fa22.selfieHint')}
            </Text>
            <Text variant="small" align="center" color={colors.navSoft}>
              {t('fa22.frontCamera')}
            </Text>
            {selfie && selfie.stamp.latitude !== null && selfie.stamp.longitude !== null ? (
              <Text variant="tiny" align="center" color={colors.navSoft}>
                {`${formatCoordinates({ latitude: selfie.stamp.latitude, longitude: selfie.stamp.longitude })} · ${formatStampIst(selfie.stamp.takenAt)}`}
              </Text>
            ) : null}
          </LinearGradient>
          <View style={styles.gap} />
          <Button
            label={done ? t('fa22.retake') : t('fa22.takeSelfie')}
            variant={done ? 'secondary' : 'primary'}
            loading={busy}
            disabled={done}
            onPress={() => setCameraOpen(true)}
            testID="fa22-take-selfie"
          />
        </Card>
        <Card>
          <ListRow
            title={t('fa22.gpsVs')}
            leading={<IconTile icon="location" accent={gap === null ? 'navy' : tooFar ? 'red' : 'green'} size={34} />}
            trailing={
              gap === null ? (
                <StatusChip label={t('common.placeholderValue')} />
              ) : (
                <StatusChip tone={tooFar ? 'tomato' : 'green'} label={tooFar ? t('fa22.farChip', { meters: gap }) : t('fa22.sameSpot', { meters: gap })} />
              )
            }
            testID="fa22-distance"
          />
          <ListRow title={t('fa22.timeAtShop')} leading={<IconTile icon="clock" accent="gold" size={34} />} trailing={<Text variant="bodyStrong">{t('common.minutes', { minutes })}</Text>} last testID="fa22-time" />
        </Card>
        {problem ? <Banner tone="error" message={problem} testID="fa22-problem" /> : null}
        <Button
          label={t('fa22.continue')}
          disabled={!done}
          onPress={() =>
            // A shop already in Laboura (a revisit) is not registered again: its visit details offer the
            // next step: "Mark onboarded" the first time, else "Already onboarded — save visit" (rev 189).
            visit.businessId
              ? router.push(pageRoutes.visitDetails(visit.id))
              : router.push({ pathname: routes.visitBusiness, params: { visitId: visit.id } })
          }
          testID="fa22-continue"
        />
        <Text variant="muted">{t('fa22.next')}</Text>
      </Screen>
      <CameraSheet open={cameraOpen} facing="front" label={visit.shopName} onCapture={(p) => void onSelfie(p)} onClose={() => setCameraOpen(false)} />
    </View>
  );
}

/** Selfie taken: navy into a deep green, so the tick reads as done. */
const doneGradient = [colors.navy, colors.green] as const;

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  gap: { height: 10 },
  photoBox: {
    alignItems: 'center',
    gap: 6,
    padding: 18,
    paddingVertical: 40,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
});
