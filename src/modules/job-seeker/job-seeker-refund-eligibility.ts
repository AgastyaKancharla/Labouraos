import { refundGuaranteeDeadline } from '../../common/money/money';

export interface JobSeekerRefundEligibilityInput {
  code: string;
  paymentReceivedAt: Date | null;
  status: string;
  hasOfferRejectedHit: boolean;
  hasExistingRefund: boolean;
}

export interface JobSeekerRefundEligibilityResult {
  eligible: boolean;
  ineligibleReason?: string;
  amountPaise: number;
  daysOwed: number;
  daysElapsed: number;
  deadline: Date | null;
}

/**
 * Evaluates Job Seeker 30-day refund guarantee eligibility.
 *
 * SHARED ELIGIBILITY LOGIC (Phase 6.5 Task 9):
 * Must be used by BOTH the approval endpoint (`JobSeekerService.approveRefund`)
 * and the listing endpoint (`GET /refunds/due`).
 *
 * Locked Domain Rules:
 * - ₹499 (49900 paise) activation fee must have been paid (paymentReceivedAt != null).
 * - Must NOT be in 'placed' status (confirmed placement).
 * - Must NOT be in 'deactivated' status (3 hits deactivate with no refund entitlement).
 * - Must NOT have any 'offer_rejected' hit (rejecting a suitable offer forfeits guarantee).
 * - Refund can only be approved after 30 days have elapsed from payment receipt (now > deadline).
 * - No refund has already been issued.
 */
export function evaluateJobSeekerRefundEligibility(
  input: JobSeekerRefundEligibilityInput,
  now: Date = new Date(),
): JobSeekerRefundEligibilityResult {
  if (!input.paymentReceivedAt) {
    return {
      eligible: false,
      ineligibleReason: `Job seeker '${input.code}' has not paid the activation fee and is not eligible for refund`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
      deadline: null,
    };
  }

  if (input.status === 'placed') {
    return {
      eligible: false,
      ineligibleReason: `Job seeker '${input.code}' has a confirmed placement and is not eligible for refund`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
      deadline: null,
    };
  }

  if (input.status === 'deactivated') {
    return {
      eligible: false,
      ineligibleReason: `Job seeker '${input.code}' is deactivated and carries no refund entitlement`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
      deadline: null,
    };
  }

  if (input.hasOfferRejectedHit) {
    return {
      eligible: false,
      ineligibleReason: `Job seeker '${input.code}' rejected a suitable offer and is not eligible for refund`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
      deadline: null,
    };
  }

  const deadline = refundGuaranteeDeadline(input.paymentReceivedAt);
  if (now.getTime() <= deadline.getTime()) {
    return {
      eligible: false,
      ineligibleReason: `Refund can only be approved after 30 days have elapsed from payment receipt (${deadline.toISOString()})`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: Math.floor((now.getTime() - input.paymentReceivedAt.getTime()) / (24 * 60 * 60 * 1000)),
      deadline,
    };
  }

  if (input.hasExistingRefund) {
    return {
      eligible: false,
      ineligibleReason: `A refund has already been issued for job seeker '${input.code}'`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
      deadline,
    };
  }

  const daysOwed = Math.floor((now.getTime() - deadline.getTime()) / (24 * 60 * 60 * 1000));
  const daysElapsed = Math.floor((now.getTime() - input.paymentReceivedAt.getTime()) / (24 * 60 * 60 * 1000));

  return {
    eligible: true,
    amountPaise: 49900,
    daysOwed,
    daysElapsed,
    deadline,
  };
}
