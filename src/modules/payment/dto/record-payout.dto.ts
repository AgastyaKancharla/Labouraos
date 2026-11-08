export interface RecordPayoutDto {
  bankUtr: string;
  receiverNameShown: string;
  paidAt?: string | Date;
  payoutAccountId?: string;
}
