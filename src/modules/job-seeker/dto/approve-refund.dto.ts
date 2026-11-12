export class ApproveJobSeekerRefundDto {
  asOf?: string;
  /** Required for a goodwill refund. */
  reason?: string;
  /**
   * A ₹499 refund outside the rules (goodwill): the CEO only, with a written reason,
   * audited. Finance cannot approve one.
   */
  goodwill?: boolean;
  /** CEO only: raise a refund that was rejected for this guarantee, with a reason (R4). */
  overrideRejection?: boolean;
}
