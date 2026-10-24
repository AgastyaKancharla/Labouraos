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
