import { refundGuaranteeDeadline } from '../../common/money/money';
import { evaluateJobSeekerRefundEligibility } from '../job-seeker/job-seeker-refund-eligibility';
import { evaluatePlacementRefundEligibility } from '../placement/placement-refund-eligibility';
import { GuaranteeState } from './growth.constants';

/**
 * N1 "Money still under guarantee" (confirmed 11 Nov). Pure rules that place one
 * received payment in one state, as of a moment:
 * - under_guarantee: still inside its guarantee, so it could still have to go back;
 * - refund_due: the guarantee ran out and a refund is owed but not yet started;
 * - refunded: a refund for it has been approved, sent or completed;
 * - safely_earned: it can no longer go back.
 * The refund rules themselves come from the shared eligibility functions, so this
 * never disagrees with the refund screens.
 */

export interface ActivationExposureInput {
  code: string;
  amountPaise: number;
  /** When this ₹499 was confirmed in the bank (starts its 30 days). */
  receivedAt: Date;
  /** False when he paid again later: this payment belongs to an earlier guarantee. */
  isLatestActivation: boolean;
  /** A live refund in this payment's guarantee cycle. */
  refundedThisCycle: boolean;
  seekerStatus: string;
  hasForfeitingHit: boolean;
  hasWithdrawnEssentialConsent: boolean;
  hasOpenBypassFlag: boolean;
  hasWorkingAtIntroducedBusinessFollowUp: boolean;
  guaranteeDays: number;
}

export interface ExposureResult {
  state: GuaranteeState;
  /** When the guarantee ends (or ended); null when not known yet (worker not joined). */
  guaranteeEndsAt: Date | null;
}

export function classifyActivationPayment(input: ActivationExposureInput, now: Date): ExposureResult {
  const deadline = refundGuaranteeDeadline(input.receivedAt, input.guaranteeDays);
  if (input.refundedThisCycle) return { state: 'refunded', guaranteeEndsAt: deadline };
  // A later ₹499 starts a new guarantee only after this one ended with no refund.
  if (!input.isLatestActivation) return { state: 'safely_earned', guaranteeEndsAt: deadline };
  const forfeited =
    ['placed', 'closed', 'deactivated'].includes(input.seekerStatus) ||
    input.hasForfeitingHit ||
    input.hasWithdrawnEssentialConsent;
  if (forfeited) return { state: 'safely_earned', guaranteeEndsAt: deadline };
  if (now.getTime() <= deadline.getTime()) return { state: 'under_guarantee', guaranteeEndsAt: deadline };
  const eligibility = evaluateJobSeekerRefundEligibility(
    {
      code: input.code,
      paymentReceivedAt: input.receivedAt,
      status: input.seekerStatus,
      hasOfferRejectedHit: input.hasForfeitingHit,
      hasExistingRefund: false,
      activationPaymentPaise: input.amountPaise,
      guaranteeDays: input.guaranteeDays,
      hasWithdrawnEssentialConsent: input.hasWithdrawnEssentialConsent,
      hasOpenBypassFlag: input.hasOpenBypassFlag,
      hasWorkingAtIntroducedBusinessFollowUp: input.hasWorkingAtIntroducedBusinessFollowUp,
    },
    now,
  );
  return { state: eligibility.eligible ? 'refund_due' : 'safely_earned', guaranteeEndsAt: deadline };
}

export interface ChainPlacement {
  id: string;
  code: string;
  status: string;
  placementFee: number;
  dropoutReportedAt: Date | null;
  guaranteeEndedReason: string | null;
  /** Claims on this placement, any order. */
  claims: Array<{ decision: string | null; reportedAt: Date | null; decidedAt: Date | null }>;
  replacementCandidates: Array<{ status: string }>;
}

export interface PlacementFeeExposureInput {
  /** The first employee's placement: its joining date starts the 60 days. */
  root: { code: string; joinedDate: Date | null; guaranteeEndedReason: string | null; status: string };
  /** The root and every replacement placement on the same guarantee. */
  chain: ChainPlacement[];
  /** A live refund on any placement of the chain. */
  refunded: boolean;
  windowDays: number;
  searchDays: number;
}

export function classifyPlacementFeePayment(input: PlacementFeeExposureInput, now: Date): ExposureResult {
  const dayMs = 24 * 60 * 60 * 1000;
  const guaranteeEndsAt = input.root.joinedDate
    ? new Date(input.root.joinedDate.getTime() + input.windowDays * dayMs)
    : null;
  if (input.refunded) return { state: 'refunded', guaranteeEndsAt };
  const endedReason = input.root.guaranteeEndedReason ?? input.chain.find((p) => p.guaranteeEndedReason)?.guaranteeEndedReason ?? null;
  // Ended with no refund (second replacement left, two replacements rejected).
  if (endedReason && endedReason !== 'refunded') return { state: 'safely_earned', guaranteeEndsAt };

  // A worker who left: the replacement window (claim decision, then the 15-day search).
  let replacementState: GuaranteeState | null = null;
  for (const placement of input.chain) {
    if (placement.status !== 'dropped_out') continue;
    const decided = placement.claims
      .filter((claim) => claim.decision)
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];
    const open = placement.claims.some((claim) => !claim.decision);
    if (open || !decided) {
      replacementState = replacementState ?? 'under_guarantee';
      continue;
    }
    if (decided.decision !== 'accepted') continue;
    const accepted = placement;
    const eligibility = evaluatePlacementRefundEligibility(
      {
        code: accepted.code,
        status: accepted.status,
        hasAcceptedReplacement: accepted.replacementCandidates.some((candidate) => candidate.status === 'accepted'),
        claimAcceptedAt: decided.decidedAt,
        dropoutReportedAt: decided.reportedAt ?? accepted.dropoutReportedAt,
        placementFee: accepted.placementFee,
        hasExistingRefund: false,
        searchDays: input.searchDays,
        guaranteeEndedReason: accepted.guaranteeEndedReason,
      },
      now,
    );
    if (eligibility.eligible) {
      replacementState = 'refund_due';
    } else if (eligibility.ineligibleReason?.startsWith('Refund is not payable before')) {
      replacementState = replacementState ?? 'under_guarantee';
    }
  }
  if (replacementState) return { state: replacementState, guaranteeEndsAt };

  // Paid but not joined yet: the 60 days have not even started.
  if (!guaranteeEndsAt) return { state: 'under_guarantee', guaranteeEndsAt: null };
  if (now.getTime() < guaranteeEndsAt.getTime()) return { state: 'under_guarantee', guaranteeEndsAt };
  return { state: 'safely_earned', guaranteeEndsAt };
}
