/**
 * Guide (decided 14 Nov): a business's area is filled in automatically from
 * its GPS location — the nearest area whose centre is within 1 km. If no area
 * is that close, the agent must pick the area from the list before saving.
 * The server makes the same check (PricingPolicy.areaAutoFillMaxMeters); this
 * copy only prefills the picker.
 */
export const DEFAULT_AREA_AUTO_FILL_MAX_METERS = 1000;

interface Point {
  latitude: number;
  longitude: number;
}

export function distanceMeters(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** The nearest area whose centre is within `maxMeters` of the pin, or null. Areas with no centre (0, 0) are skipped. */
export function nearestArea<A extends Point & { name: string }>(areas: readonly A[], pin: Point, maxMeters = DEFAULT_AREA_AUTO_FILL_MAX_METERS): A | null {
  let best: { area: A; meters: number } | null = null;
  for (const area of areas) {
    if (!area.latitude && !area.longitude) continue;
    const meters = distanceMeters(pin, area);
    if (meters <= maxMeters && (!best || meters < best.meters)) best = { area, meters };
  }
  return best?.area ?? null;
}

/** "1 km", "1.5 km" or "800 m". */
export function distanceText(meters: number): string {
  return meters >= 1000 ? `${Number((meters / 1000).toFixed(1))} km` : `${meters} m`;
}
