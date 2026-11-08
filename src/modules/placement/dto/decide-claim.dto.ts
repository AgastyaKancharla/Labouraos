export class DecideClaimDto {
  decision!: 'accepted' | 'rejected' | string;
  decisionReason!: string;
}
