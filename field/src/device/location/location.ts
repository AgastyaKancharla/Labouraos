import { LocationError, type GpsFix, type LocationProvider } from './types';

export type AccuracyLevel = 'good' | 'fair' | 'poor';

/** Shop-level proof needs ~30 m. Above 100 m the reading is not useful. */
export const GOOD_ACCURACY_M = 30;
export const FAIR_ACCURACY_M = 100;
export const DEFAULT_TIMEOUT_MS = 20_000;
/** A reading older than this is not reused (the agent may have walked away). */
export const DEFAULT_MAX_AGE_MS = 30_000;

export function classifyAccuracy(accuracyMeters: number): AccuracyLevel {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0) return 'poor';
  if (accuracyMeters <= GOOD_ACCURACY_M) return 'good';
  if (accuracyMeters <= FAIR_ACCURACY_M) return 'fair';
  return 'poor';
}

export function isValidFix(fix: GpsFix): boolean {
  return (
    Number.isFinite(fix.latitude) &&
    Number.isFinite(fix.longitude) &&
    Math.abs(fix.latitude) <= 90 &&
    Math.abs(fix.longitude) <= 180 &&
    !(fix.latitude === 0 && fix.longitude === 0)
  );
}

/** Rounds for display: 5 decimals ≈ 1 m. */
export function formatCoordinates(fix: Pick<GpsFix, 'latitude' | 'longitude'>): string {
  return `${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}`;
}

/** Distance between two readings in metres (haversine). */
export function distanceMeters(a: Pick<GpsFix, 'latitude' | 'longitude'>, b: Pick<GpsFix, 'latitude' | 'longitude'>): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * One GPS reading with its accuracy, or a LocationError the screen can
 * explain (permission off, no fix, too slow). Never hangs: the timeout is
 * enforced here even when the platform ignores it.
 */
export async function readLocation(
  provider: LocationProvider,
  options: { timeoutMs?: number; maxAgeMs?: number } = {},
): Promise<GpsFix & { level: AccuracyLevel }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const allowed = await provider.requestPermission();
  if (!allowed) throw new LocationError('permission_denied');

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LocationError('timeout')), timeoutMs);
  });
  try {
    const fix = await Promise.race([provider.getPosition({ timeoutMs, maxAgeMs }), timeout]);
    if (!isValidFix(fix)) throw new LocationError('unavailable', 'invalid coordinates');
    return { ...fix, level: classifyAccuracy(fix.accuracy) };
  } catch (error) {
    if (error instanceof LocationError) throw error;
    throw new LocationError('unavailable', error instanceof Error ? error.message : undefined);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
