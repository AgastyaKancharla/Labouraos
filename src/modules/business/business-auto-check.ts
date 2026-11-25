import { evaluateProofs, MIN_VALID_PROOFS, ProofInput, ProofResult } from './business-proofs';

/**
 * The automatic business verification (Master Guide rev 211, "Decided 25 Nov", B3), as a pure
 * decision over facts the service reads. A business goes live with no Team Lead only when
 * every condition holds; otherwise it waits in pending_tl_check with every failed reason
 * shown to the Team Lead (no sampling, no limit).
 *
 * Households hiring help (business type "household") never come here: they keep the
 * verification visit and the Team Lead check until the household research is decided.
 */

/** The shop photo's location must be within this many metres of the Maps pin (guide: "about 200 m"). */
export const SHOP_PHOTO_MAX_METERS_FROM_PIN = 200;
/** Two Maps pins this close are the same place (B3: "within ~30 m"). */
export const SAME_PLACE_METERS = 30;

export type AutoCheckCode =
  | 'owner_phone_verified'
  | 'agreement_signed_by_otp'
  | 'owner_selfie'
  | 'shop_photo'
  | 'proofs'
  | 'shop_location'
  | 'no_duplicate'
  | 'not_blocked';

export interface AutoCheckReason {
  code: AutoCheckCode;
  ok: boolean;
  /** Plain words for the Team Lead (no phone numbers or ID numbers in it). */
  detail: string;
}

export interface AutoCheckFacts extends ProofInput {
  phoneVerified: boolean;
  agreementSignedByOtp: boolean;
  hasOwnerSelfie: boolean;
  /** The second photo: the name board, or for a home business the owner holding the FSSAI licence. */
  hasShopPhoto: boolean;
  runsFromHome: boolean;
  /** Where the shop photo was taken, when the phone gave its location. */
  shopPhotoLatitude: number | null;
  shopPhotoLongitude: number | null;
  /** The phone refused (or could not give) the location when the shop photo was taken. */
  shopPhotoLocationRefused: boolean;
  /** Which of GST / licence numbers / Maps place / phone another business already has (codes of businesses only). */
  duplicates: Array<{ businessCode: string; on: string[] }>;
  banned: boolean;
  suspended: boolean;
  paused: boolean;
}

export interface AutoCheckResult {
  passed: boolean;
  reasons: AutoCheckReason[];
  proofs: ProofResult[];
  /** Metres between the shop photo and the Maps pin, when both exist. */
  distanceMeters: number | null;
}

/** Great-circle distance in metres (the same formula as common/geo). */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const PROOF_NAMES: Record<string, string> = { gst: 'GST number', licence: 'FSSAI / trade licence / Udyam', maps: 'Google Maps link' };

export function decideAutoCheck(f: AutoCheckFacts): AutoCheckResult {
  const reasons: AutoCheckReason[] = [];
  const add = (code: AutoCheckCode, ok: boolean, detail: string) => reasons.push({ code, ok, detail });

  add('owner_phone_verified', f.phoneVerified, f.phoneVerified ? "Owner's phone verified by code" : "Owner's phone is not verified by code");
  add('agreement_signed_by_otp', f.agreementSignedByOtp, f.agreementSignedByOtp ? 'Agreement signed by code' : 'Agreement not signed by code');
  add('owner_selfie', f.hasOwnerSelfie, f.hasOwnerSelfie ? "Owner's live selfie taken" : "No live selfie of the owner");
  const shopWord = f.runsFromHome ? 'Live photo of the owner holding the FSSAI licence' : "Live photo of the shop's name board";
  add('shop_photo', f.hasShopPhoto, f.hasShopPhoto ? `${shopWord} taken` : `${shopWord} missing`);

  const proofs = evaluateProofs(f);
  const valid = proofs.filter((p) => p.valid);
  const invalid = proofs.filter((p) => p.given && !p.valid);
  const proofsOk = valid.length >= MIN_VALID_PROOFS;
  add(
    'proofs',
    proofsOk,
    [
      `${valid.length} of 3 proofs valid${valid.length ? ` (${valid.map((p) => PROOF_NAMES[p.key]).join(', ')})` : ''}; at least ${MIN_VALID_PROOFS} needed${proofsOk ? '' : ' — small business checks instead: owner\'s ID, workspace photo, one business proof, an address proof and a video call with the Team Lead'}`,
      ...invalid.map((p) => `${PROOF_NAMES[p.key]}: ${p.detail ?? 'not valid'}`),
    ].join('. '),
  );

  // The 200 m check applies when the Maps link is one of the (valid) proofs.
  const mapsProof = proofs.find((p) => p.key === 'maps');
  let distanceMeters: number | null = null;
  if (mapsProof?.valid && f.mapsLatitude !== null && f.mapsLatitude !== undefined && f.mapsLongitude !== null && f.mapsLongitude !== undefined) {
    if (f.shopPhotoLatitude !== null && f.shopPhotoLongitude !== null) {
      distanceMeters = Math.round(metresBetween(f.shopPhotoLatitude, f.shopPhotoLongitude, f.mapsLatitude, f.mapsLongitude));
      const near = distanceMeters <= SHOP_PHOTO_MAX_METERS_FROM_PIN;
      add('shop_location', near, near
        ? `Shop photo taken ${distanceMeters} m from the Maps pin`
        : `Shop photo taken ${distanceMeters} m from the Maps pin (more than ${SHOP_PHOTO_MAX_METERS_FROM_PIN} m)`);
    } else {
      add('shop_location', false, f.shopPhotoLocationRefused || f.hasShopPhoto
        ? "The phone's location was not given with the shop photo, so it could not be checked against the Maps pin"
        : 'No shop photo to check against the Maps pin');
    }
  } else {
    add('shop_location', true, 'Not needed: the Maps link is not one of the proofs');
  }

  const dupOk = f.duplicates.length === 0;
  add('no_duplicate', dupOk, dupOk
    ? 'No other business has the same GST, licence, Maps place or phone'
    : f.duplicates.map((d) => `Same ${d.on.join(', ')} as ${d.businessCode}`).join('; '));

  const blocked = [f.banned ? 'matches a permanent ban' : null, f.suspended ? 'suspended by the CEO' : null, f.paused ? 'paused' : null].filter(Boolean);
  add('not_blocked', blocked.length === 0, blocked.length ? `Business is ${blocked.join(', ')}` : 'Not blocked');

  return { passed: reasons.every((r) => r.ok), reasons, proofs, distanceMeters };
}

/** The failed reasons, in plain words (status history and the Team Lead's queue). */
export function failedReasonText(reasons: AutoCheckReason[]): string {
  return reasons.filter((r) => !r.ok).map((r) => r.detail).join('; ');
}
