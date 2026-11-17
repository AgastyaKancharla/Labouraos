import { BadRequestException } from '@nestjs/common';

/**
 * Guide (decided 14 Nov): a business's area is filled in from its GPS location
 * only when an area's centre is within 1 km. The CEO can change the distance
 * on C-Pricing (PricingPolicy.areaAutoFillMaxMeters); this is the fallback when
 * a policy row has no usable value.
 */
export const DEFAULT_AREA_AUTO_FILL_MAX_METERS = 1_000;

/** "1 km", "1.5 km" or "800 m", for the "pick the area" message. */
export function distanceLabel(meters: number): { en: string } {
  if (meters >= 1000) {
    const km = Number((meters / 1000).toFixed(1)).toString();
    return { en: `${km} km` };
  }
  return { en: `${meters} m` };
}

/**
 * The refusal when no area was picked and none is close enough to fill in.
 * `code` lets the call agent console and Laboura Field show their own
 * words; `messages` carries the English for any other client (English only, rev 193).
 */
export function areaRequiredError(maxMeters: number): BadRequestException {
  const d = distanceLabel(maxMeters);
  const messages = {
    en: `Pick the area — no area is within ${d.en} of this shop`,
  };
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: 'area_required',
    message: messages.en,
    messages,
    maxMeters,
  });
}

/** The policy's auto-fill distance, or the 1 km default when it is missing or not a positive integer. */
export function areaAutoFillMaxMeters(policy: { areaAutoFillMaxMeters?: number | null } | null | undefined): number {
  const value = policy?.areaAutoFillMaxMeters;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_AREA_AUTO_FILL_MAX_METERS;
}
