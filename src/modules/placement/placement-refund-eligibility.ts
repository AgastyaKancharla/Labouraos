import { calculateDaysElapsed } from './placement.service';
import { calculateRefund } from '../../common/money/money';

export interface PlacementRefundEligibilityInput {
  code: string;
  status: string;
  eligibility: string | null;
  hasAcceptedReplacement: boolean;
  dropoutReportedAt: Date | null;
  clockPaused: boolean;
  clockPausedAt: Date | null;
  placementFee: number;
  hasExistingRefund: boolean;
}

export interface PlacementRefundEligibilityResult {
  eligible: boolean;
  ineligibleReason?: string;
  amountPaise: number;
  daysOwed: number;
  daysElapsed: number;
}

/**
 * Evaluates Placement 60-day replacement guarantee cash-refund eligibility.
 *
 * SHARED ELIGIBILITY LOGIC (Phase 6.5 Task 9):
 * Must be used by BOTH the approval endpoint (`PlacementService.approveRefund`)
 * and the listing endpoint (`GET /refunds/due`).
 *
 * Locked Domain Rules:
 * - Placement must be in 'dropped_out' status.
 * - Eligibility must be 'employee_left' ('business_breach' is ineligible for refund guarantee remedy).
 * - No replacement candidate has been accepted.
 * - dropoutReportedAt must be present.
 * - At least 15 days must have elapsed from dropoutReportedAt (taking into account clockPaused).
 * - calculateRefund(placementFee, daysElapsed) > 0.
 * - No refund has already been issued.
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

  if (input.eligibility === 'business_breach') {
    return {
      eligible: false,
      ineligibleReason: "Placement with eligibility 'business_breach' is ineligible for refund guarantee remedy",
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
    };
  }

  if (input.eligibility !== 'employee_left') {
    return {
      eligible: false,
      ineligibleReason: `Placement eligibility must be 'employee_left' to qualify for refund. Current: '${input.eligibility}'`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
    };
  }

  if (input.hasAcceptedReplacement) {
    return {
      eligible: false,
      ineligibleReason: 'Cannot approve refund when a replacement candidate has been accepted',
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
    };
  }

  if (!input.dropoutReportedAt) {
    return {
      eligible: false,
      ineligibleReason: `Dropout report date is missing for placement '${input.code}'`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
    };
  }

  const daysElapsed = calculateDaysElapsed(
    input.dropoutReportedAt,
    input.clockPaused,
    input.clockPausedAt,
    now,
  );

  const refundAmount = calculateRefund(input.placementFee, daysElapsed);
  if (daysElapsed < 15 || refundAmount <= 0) {
    return {
      eligible: false,
      ineligibleReason: `Refund is not payable before 15 days have elapsed from dropout report (days elapsed: ${daysElapsed})`,
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
      daysElapsed,
    };
  }

  const daysOwed = daysElapsed - 15;

  return {
    eligible: true,
    amountPaise: refundAmount,
    daysOwed,
    daysElapsed,
  };
}
