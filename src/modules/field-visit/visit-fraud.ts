import { calculateHaversineDistanceMeters } from '../../common/geo/geo.util';
import { IDENTICAL_READING_MIN_GAP_MS } from './field-visit.constants';

/**
 * The Team Lead's checks on shop visits (Master Guide, field agent app):
 * "very short visits, two shops too far apart for the time between them,
 * the same photo twice, GPS that looks faked, many visits with no onboarding".
 * Pure functions; the service raises the review flags (which ring the Team
 * Lead's bell).
 */
export interface Reading {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  at: Date;
}

export function isShortVisit(durationSeconds: number | null, shortMinutes: number): boolean {
  return durationSeconds !== null && durationSeconds < shortMinutes * 60;
}

/** Speed needed between two visits, or null when they are at the same spot. */
export function travelCheck(
  previous: Reading,
  next: Reading,
  policy: { maxKmh: number; sameSpotMeters: number },
): { tooFar: boolean; distanceMeters: number; minutes: number; kmh: number | null } {
  const distanceMeters = calculateHaversineDistanceMeters(previous.latitude, previous.longitude, next.latitude, next.longitude);
  const minutes = Math.max(0, (next.at.getTime() - previous.at.getTime()) / 60000);
  if (distanceMeters <= policy.sameSpotMeters) return { tooFar: false, distanceMeters, minutes, kmh: null };
  const kmh = minutes > 0 ? distanceMeters / 1000 / (minutes / 60) : Number.POSITIVE_INFINITY;
  return { tooFar: kmh > policy.maxKmh, distanceMeters, minutes, kmh: Number.isFinite(kmh) ? Math.round(kmh) : null };
}

/**
 * Reasons a GPS reading looks faked:
 * - no accuracy, or an accuracy of 0 m (real phones always report some error);
 * - the photo's own stamp says it was taken elsewhere;
 * - two readings minutes apart identical to the last digit (a fixed fake location).
 */
export function gpsSuspicions(
  reading: Reading,
  options: { stamp?: { latitude: number; longitude: number } | null; earlier?: Reading | null; sameSpotMeters: number },
): string[] {
  const reasons: string[] = [];
  if (reading.accuracyMeters === null || !(reading.accuracyMeters > 0)) reasons.push('no_accuracy');
  if (options.stamp) {
    const gap = calculateHaversineDistanceMeters(reading.latitude, reading.longitude, options.stamp.latitude, options.stamp.longitude);
    if (gap > options.sameSpotMeters) reasons.push('photo_stamp_elsewhere');
  }
  const earlier = options.earlier;
  if (
    earlier &&
    earlier.latitude === reading.latitude &&
    earlier.longitude === reading.longitude &&
    Math.abs(reading.at.getTime() - earlier.at.getTime()) >= IDENTICAL_READING_MIN_GAP_MS
  ) {
    reasons.push('identical_readings');
  }
  return reasons;
}

/** Many visits with an outcome in the window and not one onboarding. */
export function noOnboardingPattern(outcomes: string[], minVisits: number): boolean {
  return outcomes.length >= minVisits && !outcomes.includes('onboarded');
}
