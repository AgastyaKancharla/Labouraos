import { refundGuaranteeDeadline } from '../../common/money/money';

export interface JobSeekerRefundEligibilityInput {
  code: string;
  paymentReceivedAt: Date | null;
  status: string;
  hasOfferRejectedHit: boolean;
  hasExistingRefund: boolean;
  activationPaymentPaise?: number;
  guaranteeDays?: number;
  hasWithdrawnEssentialConsent?: boolean;
  hasOpenBypassFlag?: boolean;
  hasWorkingAtIntroducedBusinessFollowUp?: boolean;
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
 * Evaluates Job Seeker refund guarantee eligibility.
 *
 * SHARED ELIGIBILITY LOGIC (Phase 6.5 Task 9 & Phase 9 Task 2):
 * Must be used by BOTH the approval endpoint (`JobSeekerService.approveRefund`)
 * and the listing endpoint (`GET /refunds/due`).
 *
 * Domain Rules:
 * - Activation fee must have been paid (paymentReceivedAt != null).
 * - Must NOT be in 'placed' status (confirmed placement).
 * - Must NOT be in 'deactivated' status (3 hits deactivate with no refund entitlement).
 * - Must NOT have any 'offer_rejected' hit (rejecting a suitable offer forfeits guarantee).
 * - Refund can only be approved after guaranteeDays have elapsed from payment receipt (now > deadline).
 * - No refund has already been issued.
 * - Stored activation payment amount is returned (old records never change).
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

  if (input.hasWithdrawnEssentialConsent) {
    return {
      eligible: false,
      ineligibleReason: `Job seeker '${input.code}' withdrew essential consent after paying and is not eligible for refund`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
      deadline: null,
    };
  }

  if (input.hasOpenBypassFlag) {
    return {
      eligible: false,
      ineligibleReason: `Job seeker '${input.code}' has an open bypass_suspected flag and refund is blocked`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
      deadline: null,
    };
  }

  if (input.hasWorkingAtIntroducedBusinessFollowUp) {
    return {
      eligible: false,
      ineligibleReason: `Job seeker '${input.code}' reported working at an introduced business and refund is blocked`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed: 0,
      deadline: null,
    };
  }

  if (input.guaranteeDays === undefined) {
    throw new Error('guaranteeDays must be read from PricingPolicy');
  }
  const guaranteeDays = input.guaranteeDays;
  const deadline = refundGuaranteeDeadline(input.paymentReceivedAt, guaranteeDays);
  if (now.getTime() <= deadline.getTime()) {
    return {
      eligible: false,
      ineligibleReason: `Refund can only be approved after ${guaranteeDays} days have elapsed from payment receipt (${deadline.toISOString()})`,
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

  if (input.activationPaymentPaise === undefined) {
    return {
      eligible: false,
      ineligibleReason: `Job seeker '${input.code}' has no stored activation payment; the current price is not a refund amount`,
      amountPaise: 0,
      daysOwed: 0,
      daysElapsed,
      deadline,
    };
  }

  return {
    eligible: true,
    amountPaise: input.activationPaymentPaise,
    daysOwed,
    daysElapsed,
    deadline,
  };
}
