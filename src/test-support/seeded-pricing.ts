import { PricingPolicy, PricingService } from '../modules/pricing/pricing.service';

/**
 * The seeded PricingPolicy row (prisma/seed.ts). Unit tests that construct a
 * service by hand pass this so a missing policy fails the test instead of
 * silently charging a hard-coded amount.
 */
export const SEEDED_PRICING_POLICY = {
  activationFeePaise: 49900,
  placementFeePercent: 50,
  gstPercent: 18,
  referralPayoutPaise: 20000,
  joiningRewardPaise: 20000,
  jobSeekerGuaranteeDays: 30,
  maxHits: 3,
  replacementWindowDays: 60,
  replacementSearchDays: 15,
  maxFreeReplacements: 2,
  maxReplacementRejections: 2,
  consentWithdrawalCallWindowMinutes: 60,
  duplicateBusinessRadiusMeters: 50,
} as PricingPolicy;

export function seededPricingService(
  policy: PricingPolicy = SEEDED_PRICING_POLICY,
): PricingService {
  return {
    current: () => Promise.resolve(policy),
  } as unknown as PricingService;
}
