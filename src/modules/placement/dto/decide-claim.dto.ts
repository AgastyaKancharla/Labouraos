export class DecideClaimDto {
  decision!: 'accepted' | 'rejected' | string;
  decisionReason!: string;
  /** For a rejection: wrong_details, no_owner_call (fixable: one more report) or reviewed (default). */
  rejectionCode?: string;
}
