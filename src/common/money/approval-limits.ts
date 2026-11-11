import { formatINR } from './money';

/**
 * Approval limits (Master Guide, Finance portal):
 * - Finance approves and pays a business refund the rules say is owed, up to the
 *   business refund limit kept in Settings (₹15,000 at launch).
 * - Above the limit the CEO decides.
 * - Any refund outside the rules (goodwill) always needs the CEO.
 * - Finance can always send anything to the CEO.
 * The CEO is never limited.
 */
export type CeoApprovalReason = 'above_finance_limit' | 'goodwill' | 'sent_by_finance';

export interface BusinessRefundApprovalInput {
  actorRole: string;
  amountPaise: number;
  /** PricingPolicy.financeBusinessRefundLimitPaise. */
  limitPaise: number | null | undefined;
  outsideRules?: boolean;
  sendToCeo?: boolean;
}

/**
 * A missing or broken limit counts as zero, so every business refund goes to the
 * CEO rather than letting Finance approve an unlimited amount.
 */
export function safeLimitPaise(limitPaise: number | null | undefined): number {
  return typeof limitPaise === 'number' && Number.isSafeInteger(limitPaise) && limitPaise >= 0
    ? limitPaise
    : 0;
}

/** Returns why the CEO must approve this business refund, or null when Finance may approve it. */
export function businessRefundNeedsCeo(input: BusinessRefundApprovalInput): CeoApprovalReason | null {
  if (input.actorRole === 'ceo') return null;
  if (input.outsideRules) return 'goodwill';
  if (input.amountPaise > safeLimitPaise(input.limitPaise)) return 'above_finance_limit';
  if (input.sendToCeo) return 'sent_by_finance';
  return null;
}

export function ceoApprovalMessage(
  reason: CeoApprovalReason,
  amountPaise: number,
  limitPaise: number | null | undefined,
  paymentCode: string,
): string {
  if (reason === 'goodwill') {
    return `A refund outside the rules (goodwill) always needs the CEO. Refund ${paymentCode} of ${formatINR(amountPaise)} has been sent to the CEO for approval.`;
  }
  if (reason === 'above_finance_limit') {
    return `This refund of ${formatINR(amountPaise)} is above Finance's approval limit of ${formatINR(safeLimitPaise(limitPaise))}. Refund ${paymentCode} has been sent to the CEO for approval.`;
  }
  return `Refund ${paymentCode} of ${formatINR(amountPaise)} has been sent to the CEO for approval.`;
}
