export class ApprovePlacementRefundDto {
  asOf?: string;
  reason?: string;
  /**
   * A refund outside the rules (goodwill). It always needs the CEO and a written
   * reason; Finance sending one only passes it to the CEO.
   */
  goodwill?: boolean;
  /** Goodwill only: the amount to refund, up to the placement fee. Defaults to the full fee. */
  amountPaise?: number;
  /** Finance can always send a refund to the CEO instead of approving it. */
  sendToCeo?: boolean;
  /** CEO only: raise a refund that was rejected for this placement, with a reason (R4). */
  overrideRejection?: boolean;
}
