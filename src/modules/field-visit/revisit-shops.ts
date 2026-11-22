/**
 * Revisits, one row per shop (Master Guide rev 208, owner's field test 22 Nov:
 * "Reddy mess" showed twice). A registered shop is its business; a shop not
 * registered yet is the same shop when the name on its board matches and the
 * visits are close together (two separate "Visit a shop" visits, not only a
 * revisit chain).
 */
export const SAME_SHOP_METERS = 300;

/** "Close this revisit" reasons; `other` needs the agent's words. */
export const REVISIT_CLOSE_REASONS = ['not_interested', 'shop_closed', 'wrong_or_duplicate', 'other'] as const;
export type RevisitCloseReason = (typeof REVISIT_CLOSE_REASONS)[number];
export const REVISIT_CLOSE_NOTE_MIN = 3;
export const REVISIT_CLOSE_NOTE_MAX = 500;

export interface ShopLike {
  businessId: string | null;
  shopName: string | null;
  latitude: number;
  longitude: number;
}

export function shopNameKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function metersBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** The same shop: one business, or (neither registered) the same board name within SAME_SHOP_METERS. */
export function sameShop(a: ShopLike, b: ShopLike): boolean {
  if (a.businessId || b.businessId) return a.businessId === b.businessId;
  const name = shopNameKey(a.shopName);
  if (!name || name !== shopNameKey(b.shopName)) return false;
  const valid = (p: ShopLike) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !(p.latitude === 0 && p.longitude === 0);
  // Without a usable GPS reading the name alone decides.
  if (!valid(a) || !valid(b)) return true;
  return metersBetween(a, b) <= SAME_SHOP_METERS;
}

/** Keeps the first row of each shop (rows come newest first). */
export function onePerShop<T extends ShopLike>(rows: T[]): T[] {
  const kept: T[] = [];
  for (const row of rows) if (!kept.some((k) => sameShop(k, row))) kept.push(row);
  return kept;
}
