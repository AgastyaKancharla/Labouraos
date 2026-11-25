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
  /**
   * Rev 211: "Refund requested by the job seeker (ID not verified)" — under 18 or an ID that could
   * not be verified, before any ID check passed. Recorded only when he asked; CEO or Finance.
   */
  idNotVerified?: boolean;
}
