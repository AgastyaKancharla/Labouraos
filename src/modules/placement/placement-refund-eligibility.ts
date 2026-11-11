export interface PlacementRefundEligibilityInput {
  code: string;
  status: string;
  hasAcceptedReplacement?: boolean;
  hasSelectedReplacement?: boolean;
  /** Legacy fallback only: used when no dropout report time is known. */
  claimAcceptedAt?: Date | null;
  /** When the dropout was reported (the claim's reportedAt). Starts the 15-day clock. */
  dropoutReportedAt?: Date | null;
  placementFee: number;
  hasExistingRefund: boolean;
  searchDays?: number;
  guaranteeEndedReason?: string | null;
}

export interface PlacementRefundEligibilityResult {
  eligible: boolean;
  ineligibleReason?: string;
  amountPaise: number;
  daysOwed: number;
  daysElapsed: number;
}

/**
 * Evaluates Placement replacement guarantee cash-refund eligibility.
 *
 * Phase 17 Task 3 Domain Rules:
 * - Placement must be in 'dropped_out' status.
 * - Guarantee has not ended with no refund (second_replacement_left, two_rejections).
 * - No replacement candidate has been accepted or selected.
 * - The dropout report time must be present.
 * - At least searchDays (from PricingPolicy, default 15) must have elapsed since the
 *   dropout was REPORTED (guide: "No replacement within 15 days of the dropout report"),
 *   not since the claim was decided — the decision can take up to 48 hours.
 * - Clock does not pause and does not restart.
 * - No refund has already been issued.
 * - Flat 100% refund of placement fee when search window passes without a selection.
 */
export function evaluatePlacementRefundEligibility(
  input: PlacementRefundEligibilityInput,
  now: Date = new Date(),
): PlacementRefundEligibilityResult {
  if (input.status !== 'dropped_out') {
    return {
      eligible: false,
      ineligibleReason: `Placement must be in 'dropped_out' status to approve a refund. Current status: '${input.status}'`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
    };
  }

  if (input.guaranteeEndedReason && input.guaranteeEndedReason !== 'refunded') {
    return {
      eligible: false,
      ineligibleReason: `Guarantee ended without refund: ${input.guaranteeEndedReason}`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
    };
  }

  if (input.hasSelectedReplacement || input.hasAcceptedReplacement) {
    return {
      eligible: false,
      ineligibleReason: 'Cannot approve refund when a replacement candidate has been accepted',
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
    };
  }

  const startDate = input.dropoutReportedAt ?? input.claimAcceptedAt;
  if (!startDate) {
    return {
      eligible: false,
      ineligibleReason: `Dropout report date is missing for placement '${input.code}'`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
    };
  }

  const diffMs = Math.max(0, now.getTime() - startDate.getTime());
  const daysElapsed = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (input.searchDays === undefined) {
    throw new Error('searchDays must be read from PricingPolicy');
  }
  const searchDays = input.searchDays;

  if (daysElapsed < searchDays) {
    return {
      eligible: false,
      ineligibleReason: `Refund is not payable before ${searchDays} days have elapsed from the dropout report (days elapsed: ${daysElapsed})`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed,
    };
  }

  if (input.hasExistingRefund) {
    return {
      eligible: false,
      ineligibleReason: `A refund has already been issued for placement '${input.code}'`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
    };
  }

  const daysOwed = daysElapsed - searchDays;

  return {
    eligible: true,
    amountPaise: input.placementFee,
    daysOwed,
    daysElapsed,
  };
}
