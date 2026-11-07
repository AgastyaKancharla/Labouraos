export const BANK_FEED_PROVIDER = 'BANK_FEED_PROVIDER';

export interface BankFeedEvent {
  bankUtr: string;
  amountPaise: number;
  receivedAt: Date;
  payerName?: string;
  payerVpaMasked?: string;
  remark?: string;
}

export interface BankFeedVerificationResult {
  isValid: boolean;
  event?: BankFeedEvent;
}

export interface BankFeedProvider {
  verifyWebhook(
    rawBody: Buffer | string | undefined,
    signature?: string,
  ): Promise<BankFeedVerificationResult>;
}
