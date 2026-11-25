import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, StatusChip, Text } from '@/components';
import { stampFormFields, type CapturedPhoto } from '@/device/camera';
import { useOfflineQueue } from '@/device/offline-queue';
import { isApiError } from '@/api/errors';
import type { AgreementStatus } from '@/api/endpoints';
import { CameraSheet } from '../_visits/CameraSheet';

type ShopKind = 'shop_board' | 'fssai_with_owner' | 'workspace';
const KIND_LABEL: Record<ShopKind, MessageKey> = {
  shop_board: 'fa07b.photos.board',
  fssai_with_owner: 'fa07b.photos.fssai',
  workspace: 'fa07b.photos.workspace',
};
const VARIANT: Record<ShopKind, string> = { shop_board: 'board', fssai_with_owner: 'fssai', workspace: 'workspace' };

/**
 * FA07b (Master Guide rev 211–212, B1): before the owner signs on his phone, the agent takes the
 * owner's live selfie and the second photo — the shop's name board; for a business inside the
 * owner's home the owner holding his FSSAI licence or the workspace; for a small business with
 * little paperwork the workspace — with the GPS saved on it. Live camera only.
 */
export function OwnerPhotosCard({ businessId, photos }: { businessId: string; photos: NonNullable<AgreementStatus['ownerPhotos']> }) {
  const { t } = useI18n();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const [camera, setCamera] = useState<'selfie' | ShopKind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(slot: 'selfie' | ShopKind, photo: CapturedPhoto) {
    setBusy(true);
    setProblem(null);
    try {
      const stamp = stampFormFields(photo.stamp);
      await queue.submit(t('fa07b.photos.title'), {
        method: 'POST',
        path: `/businesses/${encodeURIComponent(businessId)}/owner-photos`,
        fields: {
          ...stamp,
          captureSource: 'live_camera',
          kind: slot === 'selfie' ? 'selfie' : 'shop',
          ...(slot === 'selfie' ? {} : { shopVariant: VARIANT[slot] }),
          ...(stamp.accuracy ? { accuracyMeters: stamp.accuracy } : {}),
          ...(slot !== 'selfie' && !stamp.latitude ? { locationStatus: 'unavailable' } : {}),
        },
        files: [{ field: 'photo', name: slot === 'selfie' ? 'owner-selfie.jpg' : 'shop.jpg', type: photo.mimeType, uri: photo.uri }],
      });
      void client.invalidateQueries({ queryKey: ['field-work'] });
    } catch (e) {
      setProblem(isApiError(e) ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  const shopKinds = photos.shopKinds.length ? photos.shopKinds : (['shop_board'] as ShopKind[]);
  return (
    <Card title={t('fa07b.photos.title')} icon="camera" accent="orange" testID="fa07b-owner-photos">
      <Text variant="muted">{t('fa07b.photos.body')}</Text>
      {photos.smallBusiness ? <Text variant="muted" testID="fa07b-small-business">{t('fa07b.photos.small')}</Text> : null}
      <View style={styles.row}>
        <Text style={styles.flex1}>{t('fa07b.photos.selfie')}</Text>
        {photos.selfie ? (
          <StatusChip tone="green" label={t('fa07b.photos.done')} />
        ) : (
          <Button label={t('fa07b.photos.take')} variant="secondary" loading={busy} onPress={() => setCamera('selfie')} testID="fa07b-take-selfie" />
        )}
      </View>
      {photos.shop ? (
        <View style={styles.row}>
          <Text style={styles.flex1}>{t(KIND_LABEL[shopKinds[0]])}</Text>
          <StatusChip tone="green" label={t('fa07b.photos.done')} />
        </View>
      ) : (
        shopKinds.map((kind) => (
          <View style={styles.row} key={kind}>
            <Text style={styles.flex1}>{t(KIND_LABEL[kind])}</Text>
            <Button label={t('fa07b.photos.take')} variant="secondary" loading={busy} onPress={() => setCamera(kind)} testID={`fa07b-take-${kind}`} />
          </View>
        ))
      )}
      {problem ? <Banner tone="error" message={problem} testID="fa07b-photo-problem" /> : null}
      <CameraSheet
        open={camera !== null}
        facing={camera === 'selfie' ? 'front' : 'back'}
        onCapture={(photo) => {
          const slot = camera;
          if (slot) void send(slot, photo);
        }}
        onClose={() => setCamera(null)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  flex1: { flex: 1 },
});
