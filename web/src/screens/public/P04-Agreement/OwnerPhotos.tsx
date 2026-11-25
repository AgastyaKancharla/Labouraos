import { useState } from 'react';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { LiveSelfie } from '../shared/LiveSelfie';
import { currentLocation, ownerStepsApi, type OwnerPhotoState, type ShopPhotoKind } from '../shared/api';
import { ActionError, Muted, Ok, Warn } from '../shared/ui';

const SHOP_LABEL: Record<ShopPhotoKind, MessageKey> = {
  shop_board: 'pub.owner.shop.board',
  fssai_with_owner: 'pub.owner.shop.fssai',
  workspace: 'pub.owner.shop.workspace',
};
const VARIANT: Record<ShopPhotoKind, 'board' | 'fssai' | 'workspace'> = { shop_board: 'board', fssai_with_owner: 'fssai', workspace: 'workspace' };

/**
 * B1 (Master Guide rev 211–212): before signing, the owner takes a live selfie and a live second
 * photo — the shop's name board; for a business inside his home himself holding the FSSAI
 * licence or the workspace; for a small business with little paperwork the workspace. Camera
 * only (LiveSelfie has no file picker). The phone's location goes with the second photo; if he
 * refuses it the photo is still taken and the page says a Team Lead will check the place.
 */
export function OwnerPhotos({ token, state, onChange }: { token: string; state: OwnerPhotoState; onChange: (next: OwnerPhotoState) => void }) {
  const t = useT();
  const [kind, setKind] = useState<ShopPhotoKind>(state.shopKind);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState(false);

  const selfie = async (photo: Blob): Promise<'done' | 'retry'> => {
    setError(null);
    try {
      const res = await ownerStepsApi.photo(token, 'selfie', photo);
      onChange(res.ownerPhotos);
      return 'done';
    } catch (e) {
      setError(e);
      return 'retry';
    }
  };
  const shop = async (photo: Blob): Promise<'done' | 'retry'> => {
    setError(null);
    try {
      const location = await currentLocation();
      setRefused(Boolean(location.locationStatus));
      const res = await ownerStepsApi.photo(token, 'shop', photo, location, VARIANT[kind]);
      onChange(res.ownerPhotos);
      return 'done';
    } catch (e) {
      setError(e);
      return 'retry';
    }
  };

  return (
    <div className="card lb-pub-card" data-testid="owner-photos">
      <strong>{t('pub.owner.title')}</strong>
      <Muted>{t('pub.owner.body')}</Muted>
      {state.smallBusiness && <Muted>{t('pub.owner.smallNote')}</Muted>}
      <h3>{t('pub.owner.selfie')}</h3>
      {state.selfie ? (
        <Ok>{t('pub.owner.done')}</Ok>
      ) : (
        <LiveSelfie active onCapture={selfie} takeLabel={t('pub.owner.take')} />
      )}
      {state.selfie && (
        <>
          <h3>{t(SHOP_LABEL[state.shop ? state.shopKind : kind])}</h3>
          {state.shop ? (
            <Ok>{t('pub.owner.done')}</Ok>
          ) : (
            <>
              {state.shopKinds.length > 1 && (
                <fieldset className="lb-pub-choice" data-testid="shop-photo-kind">
                  <legend>{t('pub.owner.choose')}</legend>
                  {state.shopKinds.map((k) => (
                    <label key={k} className="lb-pub-radio">
                      <input type="radio" name="shop-photo-kind" checked={kind === k} onChange={() => setKind(k)} /> {t(SHOP_LABEL[k])}
                    </label>
                  ))}
                </fieldset>
              )}
              <LiveSelfie active facing="environment" onCapture={shop} takeLabel={t('pub.owner.take')} />
            </>
          )}
          {refused && <Warn>{t('pub.owner.locationRefused')}</Warn>}
        </>
      )}
      <ActionError error={error} />
    </div>
  );
}
