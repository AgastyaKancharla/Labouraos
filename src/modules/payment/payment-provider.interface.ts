export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export interface WebhookVerificationResult {
  isValid: boolean;
  gatewayReference: string;
  status: 'succeeded' | 'failed';
  amountPaise?: number;
  rawPayload?: Record<string, unknown>;
}

export interface DisbursePayoutResult {
  success: boolean;
  gatewayReference: string;
  status: 'succeeded' | 'failed';
  failureReason?: string;
}

export interface PaymentProvider {
  createCharge(
    amountPaise: number,
    subjectType: string,
    subjectId: string,
  ): Promise<{ paymentLink: string; gatewayReference: string }>;

  /**
   * `metadata.paymentId` is the id of the Payment being paid out. Real providers
   * derive their idempotency key from it so a retry cannot pay twice.
   */
  disbursePayout(
    amountPaise: number,
    subjectType: string,
    subjectId: string,
    metadata?: Record<string, unknown>,
  ): Promise<DisbursePayoutResult>;

  verifyWebhook(
    payload: unknown,
    signature?: string,
  ): Promise<WebhookVerificationResult>;
}
