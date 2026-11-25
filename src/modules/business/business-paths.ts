import { MIN_VALID_PROOFS, ProofInput, validProofCount } from './business-proofs';

/**
 * Which verification path a business follows (Master Guide rev 211–212, 25 Nov):
 *  - household: a household hiring help (business type household or villa) keeps the
 *    verification visit and the Team Lead check, unchanged;
 *  - standard: 2 or more proofs, verified automatically when every condition holds;
 *  - small_business: fewer than 2 proofs (home-run, new, unregistered, no Google listing):
 *    the owner as a person and the place he works from — the owner's ID, a workspace photo,
 *    one business proof, one address proof and a video call with the Team Lead.
 */
export const HOUSEHOLD_BUSINESS_TYPES = ['household', 'villa_gated_community'] as const;

export function isHouseholdBusiness(businessType: string | null | undefined): boolean {
  return (HOUSEHOLD_BUSINESS_TYPES as readonly string[]).includes(businessType ?? '');
}

export type VerificationPath = 'household' | 'standard' | 'small_business';

export function verificationPathOf(b: ProofInput & { businessType: string | null }): VerificationPath {
  if (isHouseholdBusiness(b.businessType)) return 'household';
  return validProofCount(b) >= MIN_VALID_PROOFS ? 'standard' : 'small_business';
}

export type ShopPhotoKind = 'shop_board' | 'fssai_with_owner' | 'workspace';

/**
 * The second owner photo: the shop's name board; for a business inside the owner's home the
 * owner holding the FSSAI licence (home food business) or a photo of the workspace; for a small
 * business with little paperwork the workspace, whatever it is (or the name board if it has one).
 */
export function allowedShopKinds(b: ProofInput & { businessType: string | null; runsFromHome: boolean }): ShopPhotoKind[] {
  if (b.runsFromHome) return ['fssai_with_owner', 'workspace'];
  if (verificationPathOf(b) === 'small_business') return ['shop_board', 'workspace'];
  return ['shop_board'];
}
