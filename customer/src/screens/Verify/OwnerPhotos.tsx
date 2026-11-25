import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Card, Text } from '@/components';
import { RadioGroup } from '@/components/form';
import { readPin } from '@/device/location';
import { useI18n, type MessageKey } from '@/i18n';
import { stepErrorText } from '@/verify/errors';
import { LiveCapture } from '@/verify/LiveCapture';
import { useStepsApi } from '@/verify/StepsApiProvider';
import type { OwnerPhotoState, PhotoPlace, ShopPhotoKind } from '@/verify/types';

const SHOP_LABEL: Record<ShopPhotoKind, MessageKey> = {
  shop_board: 'owner.shop.board',
  fssai_with_owner: 'owner.shop.fssai',
  workspace: 'owner.shop.workspace',
};

/**
 * Rev 211–212 (B1), on the agreement before signing: the owner's live selfie,
 * then a live photo of the shop's name board (a business in his home: himself
 * holding the FSSAI licence, or the workspace). Camera only. The phone's place
 * goes with the shop photo; if he refuses it the photo still goes and a Team
 * Lead checks the place instead. The same endpoint as the agreement link page.
 */
export function OwnerPhotos({ token, state, onChange }: { token: string; state: OwnerPhotoState; onChange: (next: OwnerPhotoState) => void }) {
  const { t } = useI18n();
  const api = useStepsApi();
  const [kind, setKind] = useState<ShopPhotoKind>(state.shopKind);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  const send = async (slot: 'selfie' | 'shop', photo: Parameters<typeof api.agreementOwnerPhoto>[2]): Promise<'done' | 'retry'> => {
    setError(null);
    try {
      let place: PhotoPlace = {};
      if (slot === 'shop') {
        const where = await readPin();
        place = where.status === 'ok'
          ? { latitude: where.pin.latitude, longitude: where.pin.longitude, ...(where.pin.accuracyM !== null ? { accuracyMeters: where.pin.accuracyM } : {}) }
          : { locationStatus: where.status === 'denied' ? 'refused' : 'unavailable' };
        setRefused(where.status !== 'ok');
      }
      const res = await api.agreementOwnerPhoto(token, slot, photo, place, slot === 'shop' ? kind : undefined);
      onChange(res.ownerPhotos);
      return 'done';
    } catch (e) {
      setError(stepErrorText(t, e));
      return 'retry';
    }
  };

  return (
    <Card title={t('owner.title')} accent="royal" testID="owner-photos">
      <View style={styles.gap}>
        <Text variant="muted">{t('owner.body')}</Text>
        <Text variant="bodyStrong">{t('owner.selfie')}</Text>
        {state.selfie ? (
          <Banner tone="ok" message={t('owner.done')} testID="owner-selfie-done" />
        ) : (
          <LiveCapture kind="selfie" tips={t('owner.selfieTips')} takeLabel={t('owner.take')} savingLabel={t('owner.saving')} onCapture={(p) => send('selfie', p)} testID="owner-selfie" />
        )}
        {state.selfie ? (
          <>
            <Text variant="bodyStrong">{t(SHOP_LABEL[state.shop ? state.shopKind : kind])}</Text>
            {state.shop ? (
              <Banner tone="ok" message={t('owner.done')} testID="owner-shop-done" />
            ) : (
              <>
                {state.shopKinds.length > 1 ? (
                  <RadioGroup
                    label={t('owner.choose')}
                    value={kind}
                    options={state.shopKinds.map((k) => ({ value: k, label: t(SHOP_LABEL[k]) }))}
                    onChange={setKind}
                    testID="owner-shop-kind"
                  />
                ) : null}
                <LiveCapture kind="card" tips={t('owner.shopTips')} takeLabel={t('owner.take')} savingLabel={t('owner.saving')} onCapture={(p) => send('shop', p)} testID="owner-shop" />
              </>
            )}
            {refused ? <Banner tone="warn" message={t('owner.locationRefused')} testID="owner-location-refused" /> : null}
          </>
        ) : null}
        {error ? <Banner tone="error" message={error} testID="owner-photos-error" /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 } });
